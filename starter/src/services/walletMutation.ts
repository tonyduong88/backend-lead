import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { Wallet, WalletTx } from '../db/models';
import { LedgerKind } from '../db/models/walletTx';
import { AppError, databaseErrorCode } from '../lib/errors';
import { dec, money, ZERO } from '../lib/money';
import { config } from '../config';
import { observe } from '../lib/metrics';

const deadlines = new WeakMap<Transaction, number>();

export function checkDeadline(t: Transaction): void {
  const deadline = deadlines.get(t);
  if (deadline !== undefined && performance.now() >= deadline) throw new AppError(503, 'transaction_deadline');
}

export async function walletTransaction<T>(work: (t: Transaction) => Promise<T>): Promise<T> {
  const start = performance.now();
  const deadline = start + config.transactionDeadlineMs;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, async t => {
          deadlines.set(t, deadline);
          checkDeadline(t);
          const result = await work(t);
          checkDeadline(t); // Throwing here rolls back; never leave an abandoned Promise.race transaction.
          return result;
        });
      } catch (error) {
        const code = databaseErrorCode(error);
        // These PostgreSQL errors abort the entire transaction. No network effects happen in work().
        if (!['40P01', '40001'].includes(code ?? '') || attempt >= 2 || performance.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20 * (attempt + 1)));
      }
    }
  } finally { observe('transaction', performance.now() - start); }
}

export async function lockWallet(where: { id: string } | { memberId: string }, t: Transaction): Promise<Wallet> {
  checkDeadline(t);
  const wallet = await Wallet.findOne({ where, transaction: t, lock: t.LOCK.NO_KEY_UPDATE });
  if (!wallet) throw new AppError(404, 'member_or_wallet_not_found');
  return wallet;
}

export async function postEntry(wallet: Wallet, effect: {
  id?: string; fundingTxId?: string; kind: LedgerKind; operationKey: string;
  delta: string; requiredDelta?: string; accruedDelta?: string;
}, t: Transaction): Promise<WalletTx> {
  checkDeadline(t);
  const next = dec(wallet.balance).plus(dec(effect.delta));
  if (next.lt(ZERO)) throw new AppError(422, 'insufficient_funds');
  const balance = money(next);
  const requiredTurnover = money(dec(wallet.requiredTurnover).plus(dec(effect.requiredDelta ?? '0')));
  const accruedTurnover = money(dec(wallet.accruedTurnover).plus(dec(effect.accruedDelta ?? '0')));
  const entry = await WalletTx.create({
    id: effect.id ?? randomUUID(), walletId: wallet.id, fundingTxId: effect.fundingTxId ?? null,
    kind: effect.kind, operationKey: effect.operationKey, delta: money(effect.delta, true),
    requiredTurnoverDelta: money(effect.requiredDelta ?? '0'),
    accruedTurnoverDelta: money(effect.accruedDelta ?? '0'),
  }, { transaction: t });
  checkDeadline(t);
  await wallet.update({ balance, requiredTurnover, accruedTurnover }, { transaction: t });
  return entry;
}
