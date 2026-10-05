'use strict';
const { QueryTypes, Transaction } = require('sequelize');
const { dec, ZERO, money } = require('../../dist/lib/money');

async function reconcile(db) {
  return db.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async transaction => {
    const wallets = await db.query('SELECT id, balance, required_turnover, accrued_turnover FROM wallets ORDER BY id', { transaction, type: QueryTypes.SELECT });
    const funding = await db.query('SELECT id, type, status FROM funding_txs ORDER BY id', { transaction, type: QueryTypes.SELECT });
    const ledger = await db.query('SELECT * FROM wallet_txs ORDER BY id', { transaction, type: QueryTypes.SELECT });
    const byWallet = new Map(); const byFunding = new Map();
    for (const row of ledger) {
      const sums = byWallet.get(row.wallet_id) || [ZERO, ZERO, ZERO];
      byWallet.set(row.wallet_id, [sums[0].plus(dec(row.delta)), sums[1].plus(dec(row.required_turnover_delta)), sums[2].plus(dec(row.accrued_turnover_delta))]);
      if (row.funding_tx_id) byFunding.set(row.funding_tx_id, (byFunding.get(row.funding_tx_id) || 0) + 1);
    }
    for (const wallet of wallets) {
      const sums = byWallet.get(wallet.id) || [ZERO, ZERO, ZERO];
      if ([wallet.balance, wallet.required_turnover, wallet.accrued_turnover].some((value, i) => !dec(value).eq(sums[i]))) {
        throw new Error('Ledger-wallet reconciliation failed');
      }
      money(wallet.balance); // Includes range and nonnegative validation.
    }
    for (const row of funding) {
      const expected = row.type === 'Withdrawal' || row.status === 'Completed' ? 1 : 0;
      if ((byFunding.get(row.id) || 0) !== expected) throw new Error('Funding-ledger reconciliation failed');
    }
    return { wallets: wallets.length, funding: funding.length, ledger: ledger.length, reconciled: true };
  });
}
module.exports = { reconcile };
