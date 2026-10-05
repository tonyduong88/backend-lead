import { randomUUID } from 'node:crypto';
import { money, positiveAmount } from '../lib/money';
import { lockWallet, postEntry, walletTransaction } from './walletMutation';

export async function recordWager(walletId: string, value: string) {
  const amount = positiveAmount(value);
  const id = randomUUID(); // Stable across an internal retry, not an HTTP idempotency key.
  return walletTransaction(async t => {
    const wallet = await lockWallet({ id: walletId }, t);
    await postEntry(wallet, { id, kind: 'WagerDebit', operationKey: 'wager:' + id,
      delta: money(amount.negated(), true), accruedDelta: money(amount) }, t);
    return { id, walletId, amount: money(amount), balance: wallet.balance };
  });
}
