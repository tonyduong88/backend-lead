'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { QueryTypes } = require('sequelize');
const { withTestLock, withScratchDatabase } = require('./lib/isolated');
const { connect, settings, safeFailure } = require('./lib/db');
const { reconcile } = require('./lib/reconcile');

async function fingerprint(db) {
  const all = [];
  for (const table of ['members', 'wallets', 'funding_txs', 'wallet_txs']) {
    all.push(await db.query('SELECT * FROM ' + table + ' ORDER BY id', { type: QueryTypes.SELECT }));
  }
  all.push(await db.query('SELECT * FROM "SequelizeMeta" ORDER BY name', { type: QueryTypes.SELECT }));
  return createHash('sha256').update(JSON.stringify(all)).digest('hex');
}

withTestLock(async source => {
  const before = await reconcile(source);
  const expected = await fingerprint(source);
  const sourceDb = new URL(settings(true).migration).pathname.slice(1);
  const admin = new URL(process.env.ADMIN_DATABASE_URL);
  const container = process.env.PG_CONTAINER || 'starter-postgres-1';
  fs.mkdirSync('artifacts', { recursive: true });
  const dump = execFileSync('docker', ['exec', container, 'pg_dump', '-U', decodeURIComponent(admin.username),
    '-d', sourceDb, '--format=custom', '--no-owner', '--no-acl', '--schema=public'], { maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync('artifacts/wallet-test.dump', dump, { mode: 0o600 });
  await withScratchDatabase('restore', async target => {
    const empty = connect(target.ownerUrl, 'mini-wallet-restore-prepare');
    try {
      // Only this newly created scratch DB: allow the dump to recreate public
      // with its original schema metadata. No CASCADE, so unexpected data stops us.
      await empty.query('DROP SCHEMA public');
    } finally { await empty.close(); }
    execFileSync('docker', ['exec', '-i', container, 'pg_restore', '-U', decodeURIComponent(admin.username),
      '-d', target.name, '--no-owner', '--no-acl', '--role=wallet_test_owner', '--exit-on-error'],
      { input: dump, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    const db = connect(target.ownerUrl, 'mini-wallet-restore-verification');
    try {
      // Logical dumps omit cluster roles and these dumps intentionally omit ACLs.
      await require('../src/db/migrations/20261002000002-runtime-grants').up(db.getQueryInterface());
      await db.query('REVOKE ALL ON FUNCTION reject_ledger_mutation() FROM PUBLIC');
      const after = await reconcile(db);
      if (await fingerprint(db) !== expected) throw new Error('Restored data or migration history differs from source');
      const runtime = connect(target.runtimeUrl, 'mini-wallet-restored-runtime');
      try {
        await reconcile(runtime);
        const [grants] = await runtime.query("SELECT has_table_privilege(current_user,'wallet_txs','UPDATE') AS can_update", { type: QueryTypes.SELECT });
        if (grants.can_update) throw new Error('Restored ledger grants are too broad');
      } finally { await runtime.close(); }
      const report = { sourceDatabase: sourceDb, before, after, identical: true, runtimeGrantsVerified: true,
        limitation: 'Logical local restore drill; not a production PITR/HA test' };
      fs.writeFileSync('artifacts/restore.json', JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report, null, 2));
    } finally { await db.close(); }
  });
}).catch(safeFailure);
