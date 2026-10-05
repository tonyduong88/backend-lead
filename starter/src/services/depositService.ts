import { randomUUID } from 'node:crypto';
import { FundingTx, Wallet } from '../db/models';
import { AppError } from '../lib/errors';
import { money, multiplier, positiveAmount, requirement } from '../lib/money';

export async function createDeposit(input: { memberId: string; amount: string; turnoverMultiplier?: number }) {
  const amount = money(positiveAmount(input.amount));
  const factor = multiplier(input.turnoverMultiplier ?? 1);
  requirement(amount, factor); // Reject an unrepresentable requirement before accepting the deposit.
  const wallet = await Wallet.findOne({ where: { memberId: input.memberId }, attributes: ['id'] });
  if (!wallet) throw new AppError(404, 'member_or_wallet_not_found');
  // Only one row is written. No wallet lock is necessary until completion.
  const funding = await FundingTx.create({ walletId: wallet.id, type: 'Deposit', status: 'Pending',
    amount, turnoverMultiplier: factor, provider: 'mock', pspRef: randomUUID() });
  return { id: funding.id, pspRef: funding.pspRef, status: funding.status };
}
