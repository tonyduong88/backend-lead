'use strict';
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { QueryTypes } = require('sequelize');
const { withTestLock, withScratchDatabase } = require('./lib/isolated');
const { connect, safeFailure } = require('./lib/db');
const { reconcile } = require('./lib/reconcile');

function migrate(target, args = []) {
  return execFileSync(process.execPath, ['scripts/migrate.js', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test',
      DATABASE_URL_TEST: target.runtimeUrl, DATABASE_URL_TEST_OWNER: target.ownerUrl, TEST_DATABASE_ALLOWLIST: target.name },
  });
}

async function main() {
  const results = [];
  for (const mode of ['fresh', 'legacy']) {
    await withScratchDatabase('verify', async target => {
      const db = connect(target.ownerUrl, 'mini-wallet-migration-verification');
      try {
        if (mode === 'legacy') {
          migrate(target, ['--to', '20260701000002-create-wallets.js']);
          const memberId = randomUUID(); const walletId = randomUUID();
          await db.transaction(async transaction => {
            await db.query("INSERT INTO members(id,username) VALUES ($id,'legacy-fixture')", { bind: { id: memberId }, transaction });
            await db.query("INSERT INTO wallets(id,member_id,balance) VALUES ($id,$member,'1')", { bind: { id: walletId, member: memberId }, transaction });
          });
          let refused = false;
          try { migrate(target); } catch { refused = true; }
          if (!refused) throw new Error('Migration accepted unverifiable opening money');
          const [state] = await db.query("SELECT to_regclass('funding_txs') IS NULL AS rolled_back, balance FROM wallets", { type: QueryTypes.SELECT });
          if (!state.rolled_back || state.balance !== '1.000000000000000000') throw new Error('Migration failure did not preserve legacy data');
          // This one synthetic fixture is returned to its initial zero balance to test a valid upgrade.
          await db.query("UPDATE wallets SET balance='0' WHERE id=$id", { bind: { id: walletId } });
        }
        migrate(target);
        const verified = await reconcile(db);
        if (mode === 'legacy' && verified.wallets !== 1) throw new Error('Legacy wallet was not preserved');
        results.push({ mode, ...verified, nonzeroLegacyRefused: mode === 'legacy' ? true : undefined });
      } finally { await db.close(); }
    });
  }
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/migrations.json', JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}
withTestLock(main).catch(safeFailure);
