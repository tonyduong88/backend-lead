import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { FundingTx, Wallet, WalletTx } from '../src/db/models';
import { money, MAX_MONEY } from '../src/lib/money';
import { handleDepositObservation } from '../src/services/fundingCallbackService';
import { app, callback, databaseHooks, deposit, fund, member, reconcile } from './helpers/database';

databaseHooks();

it('creates only a Pending funding transaction; multiplier defaults to one', async () => {
  const who = await member();
  const response = await request(app).post('/deposits').send({ memberId: who.memberId, amount: '100.50' });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ status: 'Pending', pspRef: expect.any(String), id: expect.any(String) });
  const funding = await FundingTx.findByPk(response.body.id);
  expect(funding!.turnoverMultiplier).toBe('1');
  expect(funding!.amount).toBe(money('100.50'));
  expect(await WalletTx.count()).toBe(0);
  await reconcile();
});

it('sequential replay including equivalent decimal formatting only credits once', async () => {
  const who = await member();
  const d = await deposit(who.memberId, '100.50', 2);
  expect((await callback(d.pspRef, '100.5')).status).toBe(200);
  expect((await callback(d.pspRef, '100.500')).status).toBe(200);
  expect(await WalletTx.count()).toBe(1);
  const wallet = await Wallet.findByPk(who.walletId);
  expect(wallet!.balance).toBe(money('100.5'));
  expect(wallet!.requiredTurnover).toBe(money('201'));
  await reconcile();
});

it('rejects mismatches and unknown references without poisoning a later correct callback', async () => {
  const who = await member(); const d = await deposit(who.memberId);
  expect((await callback('unknown')).status).toBe(404);
  expect((await callback(d.pspRef, '99')).status).toBe(422);
  expect((await FundingTx.findByPk(d.id))!.status).toBe('Pending');
  expect(await WalletTx.count()).toBe(0);
  expect((await callback(d.pspRef)).status).toBe(200);
  expect((await callback(d.pspRef, '99')).status).toBe(422);
  await reconcile();
});

it.each(['completed', 'failed'])('enforces terminal transitions after %s, including exact replay', async status => {
  const who = await member(); const d = await deposit(who.memberId);
  expect((await callback(d.pspRef, '100', status)).status).toBe(200);
  expect((await callback(d.pspRef, '100', status)).status).toBe(200);
  expect((await callback(d.pspRef, '100', status === 'completed' ? 'failed' : 'completed')).status).toBe(409);
  expect(await WalletTx.count()).toBe(status === 'completed' ? 1 : 0);
  await reconcile();
});

it('blocks and unblocks withdrawal exactly at the cumulative turnover boundary', async () => {
  const who = await member(); await fund(who.memberId, '100', 1); await fund(who.memberId, '50', 0);
  const withdraw = () => request(app).post('/withdrawals').send({ memberId: who.memberId, amount: '50' });
  const locked = await withdraw();
  expect(locked.status).toBe(422);
  expect(locked.body.outstandingTurnover).toBe(money('100'));
  expect((await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '99.99' })).status).toBe(201);
  const boundary = await withdraw();
  expect(boundary.status).toBe(422);
  expect(boundary.body.outstandingTurnover).toBe(money('0.01'));
  expect((await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '0.01' })).status).toBe(201);
  const allowed = await withdraw();
  expect(allowed.status).toBe(201);
  expect(allowed.body).toMatchObject({ balance: money('0'), status: 'Pending' });
  expect(await FundingTx.count({ where: { type: 'Withdrawal' } })).toBe(1);
  expect((await Wallet.findByPk(who.walletId))!.accruedTurnover).toBe(money('100'));
  await reconcile();
});

it('keeps accrued turnover across deposits/withdrawals and never counts failed wagers', async () => {
  const who = await member(); await fund(who.memberId, '50', 0);
  expect((await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '60' })).status).toBe(422);
  expect((await Wallet.findByPk(who.walletId))!.accruedTurnover).toBe(money('0'));
  await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '20' }).expect(201);
  await fund(who.memberId, '10', 2); // Prior accrued 20 satisfies the new required 20.
  await request(app).post('/withdrawals').send({ memberId: who.memberId, amount: '40' }).expect(201);
  await request(app).post('/withdrawals').send({ memberId: who.memberId, amount: '1' }).expect(422);
  expect((await Wallet.findByPk(who.walletId))!.accruedTurnover).toBe(money('20'));
  await reconcile();
});

it('preserves all 18 fractional digits through routes, DB and ledger', async () => {
  const who = await member();
  await fund(who.memberId, '0.100000000000000001');
  await fund(who.memberId, '0.200000000000000002');
  const result = await request(app).get('/members/' + who.memberId + '/wallet');
  expect(result.body.balance).toBe('0.300000000000000003');
  const wager = await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '0.000000000000000001' });
  expect(wager.body.balance).toBe('0.300000000000000002');
  await reconcile();
});

it.each([0, 1.5, '', '0', '-1', '1e2', 'NaN', 'Infinity', ' 1', '1 ', '1.0000000000000000001', '1000000000000000000'])('rejects invalid money %p', async amount => {
  const who = await member();
  await request(app).post('/deposits').send({ memberId: who.memberId, amount }).expect(400);
  expect(await FundingTx.count()).toBe(0);
});

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects invalid multiplier %p', async turnoverMultiplier => {
  const who = await member();
  await request(app).post('/deposits').send({ memberId: who.memberId, amount: '1', turnoverMultiplier }).expect(400);
});

it('rejects product and aggregate overflows without partial writes', async () => {
  const who = await member();
  await request(app).post('/deposits').send({ memberId: who.memberId, amount: money(MAX_MONEY), turnoverMultiplier: 2 }).expect(422);
  await fund(who.memberId, money(MAX_MONEY));
  const d = await deposit(who.memberId, '1');
  expect((await callback(d.pspRef, '1')).status).toBe(422);
  expect((await FundingTx.findByPk(d.id))!.status).toBe('Pending');
  expect(await WalletTx.count()).toBe(1);
  await reconcile();
});

it.each(['required', 'accrued'])('rejects %s turnover overflow independently from balance', async field => {
  const who = await member();
  await fund(who.memberId, money(MAX_MONEY), field === 'required' ? 1 : 0);
  await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: money(MAX_MONEY) }).expect(201);
  const d = await deposit(who.memberId, '1', field === 'required' ? 1 : 0);
  expect((await callback(d.pspRef, '1')).status).toBe(field === 'required' ? 422 : 200);
  if (field === 'accrued') await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '1' }).expect(422);
  await reconcile();
});

it('rolls back ledger and wallet when the final funding transition fails, then safely retries', async () => {
  const who = await member(); const d = await deposit(who.memberId, '100', 1);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const fail = jest.spyOn(FundingTx.prototype, 'update').mockRejectedValueOnce(new Error('injected final write failure'));
  expect((await callback(d.pspRef)).status).toBe(500);
  expect((await FundingTx.findByPk(d.id))!.status).toBe('Pending');
  expect(await WalletTx.count()).toBe(0);
  expect((await Wallet.findByPk(who.walletId))!.balance).toBe(money('0'));
  await reconcile();
  fail.mockRestore();
  expect((await callback(d.pspRef)).status).toBe(200);
  await reconcile();
});

it.each(['wager', 'withdrawal'])('rolls back every %s write on wallet update failure', async operation => {
  const who = await member(); await fund(who.memberId);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(Wallet.prototype, 'update').mockRejectedValueOnce(new Error('injected wallet failure'));
  const response = operation === 'wager'
    ? await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '10' })
    : await request(app).post('/withdrawals').send({ memberId: who.memberId, amount: '10' });
  expect(response.status).toBe(500);
  expect(await WalletTx.count()).toBe(1);
  expect(await FundingTx.count()).toBe(1);
  await reconcile();
});

it('treats pending provider observations as no-ops, including after completion', async () => {
  const who = await member(); const d = await deposit(who.memberId);
  const event = { kind: 'observation' as const, provider: 'mock', pspRef: d.pspRef, status: 'pending' as const };
  expect((await handleDepositObservation(event)).status).toBe('Pending');
  expect((await callback(d.pspRef)).status).toBe(200);
  expect((await handleDepositObservation(event)).status).toBe('Completed');
  await expect(handleDepositObservation({ ...event, amount: '99' })).rejects.toMatchObject({ code: 'callback_amount_mismatch' });
  await expect(handleDepositObservation({ ...event, pspRef: 'unknown' })).rejects.toMatchObject({ code: 'funding_not_found' });
  expect((await callback(d.pspRef, '100', 'pending')).status).toBe(400); // Mock HTTP contract remains unchanged.
  await reconcile();
});

it('validates identifiers, unknown members, malformed JSON, and duplicate usernames', async () => {
  await request(app).get('/members/not-uuid/wallet').expect(400);
  await request(app).post('/wallets/not-uuid/wagers').send({ amount: '1' }).expect(400);
  await request(app).post('/withdrawals').send({ memberId: randomUUID(), amount: '1' }).expect(404);
  await request(app).post('/deposits').send({ memberId: randomUUID(), amount: '1' }).expect(404);
  await request(app).post('/deposits').set('Content-Type', 'application/json').send('{').expect(400);
  await request(app).post('/psp/callbacks').set('Content-Type', 'application/json').send('{').expect(400);
  await request(app).post('/members').send({ username: 'duplicate' }).expect(201);
  await request(app).post('/members').send({ username: 'duplicate' }).expect(409);
});
