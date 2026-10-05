import { randomUUID } from 'node:crypto';
import { FundingTx } from '../db/models';
import { AppError } from '../lib/errors';
import { dec, money, outstanding, positiveAmount, ZERO } from '../lib/money';
import { lockWallet, postEntry, walletTransaction } from './walletMutation';

export async function createWithdrawal(input: { memberId: string; amount: string }) {
  const amount = positiveAmount(input.amount);
  const id = randomUUID();
  return walletTransaction(async t => {
    const wallet = await lockWallet({ memberId: input.memberId }, t);
    const remaining = outstanding(wallet.requiredTurnover, wallet.accruedTurnover);
    if (dec(remaining).gt(ZERO)) throw new AppError(422, 'turnover_locked', {
      outstandingTurnover: remaining, requiredTurnover: wallet.requiredTurnover, accruedTurnover: wallet.accruedTurnover,
    });
    if (dec(wallet.balance).lt(amount)) throw new AppError(422, 'insufficient_funds');
    const funding = await FundingTx.create({ id, walletId: wallet.id, type: 'Withdrawal',
      status: 'Pending', amount: money(amount) }, { transaction: t });
    await postEntry(wallet, { kind: 'WithdrawalDebit', fundingTxId: id,
      operationKey: 'withdrawal:' + id, delta: money(amount.negated(), true) }, t);
    return { id: funding.id, status: funding.status, balance: wallet.balance };
  });
}
