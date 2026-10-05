import { FundingTx } from '../db/models';
import { AppError } from '../lib/errors';
import { dec, money, positiveAmount, requirement } from '../lib/money';
import { checkDeadline, lockWallet, postEntry, walletTransaction } from './walletMutation';
import { DepositObservation, TerminalDepositEvent } from '../integrations/psp/types';

export async function handleDepositCallback(event: TerminalDepositEvent) {
  const amount = money(positiveAmount(event.amount));
  if (!['completed', 'failed'].includes(event.status)) throw new AppError(400, 'invalid_callback_status');
  return walletTransaction(async t => {
    const located = await FundingTx.findOne({ where: {
      provider: event.provider, pspRef: event.pspRef, type: 'Deposit',
    }, attributes: ['id', 'walletId'], transaction: t });
    if (!located) throw new AppError(404, 'funding_not_found');
    const wallet = await lockWallet({ id: located.walletId }, t);
    const funding = await FundingTx.findByPk(located.id, { transaction: t, lock: t.LOCK.NO_KEY_UPDATE });
    if (!funding) throw new AppError(404, 'funding_not_found');
    if (!dec(funding.amount).eq(dec(amount))) throw new AppError(422, 'callback_amount_mismatch');
    const next = event.status === 'completed' ? 'Completed' : 'Failed';
    if (funding.status === next) return { id: funding.id, status: funding.status };
    if (funding.status !== 'Pending') throw new AppError(409, 'invalid_funding_transition');
    if (next === 'Completed') {
      await postEntry(wallet, { kind: 'DepositCredit', fundingTxId: funding.id,
        operationKey: 'deposit:' + funding.id, delta: funding.amount,
        requiredDelta: requirement(funding.amount, funding.turnoverMultiplier!),
      }, t);
    }
    checkDeadline(t);
    await funding.update({ status: next }, { transaction: t });
    return { id: funding.id, status: funding.status };
  });
}

// Intermediate PSP observations never become a request to mutate money or regress a terminal state.
export async function handleDepositObservation(event: DepositObservation) {
  const amount = event.amount === undefined ? undefined : money(positiveAmount(event.amount));
  return walletTransaction(async t => {
    const located = await FundingTx.findOne({ where: { provider: event.provider, pspRef: event.pspRef,
      type: 'Deposit' }, attributes: ['id', 'walletId'], transaction: t });
    if (!located) throw new AppError(404, 'funding_not_found');
    await lockWallet({ id: located.walletId }, t);
    const funding = await FundingTx.findByPk(located.id, { transaction: t, lock: t.LOCK.NO_KEY_UPDATE });
    if (!funding) throw new AppError(404, 'funding_not_found');
    if (amount !== undefined && !dec(funding.amount).eq(dec(amount))) throw new AppError(422, 'callback_amount_mismatch');
    return { id: funding.id, status: funding.status };
  });
}
