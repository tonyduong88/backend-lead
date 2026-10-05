import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../src/db/sequelize';
import { FundingTx, Wallet, WalletTx } from '../src/db/models';
import { config } from '../src/config';
import { money } from '../src/lib/money';
import { walletTransaction } from '../src/services/walletMutation';
import { app, callback, databaseHooks, deposit, fund, holdWallet, member, owner, raceOnWallet, reconcile } from './helpers/database';

databaseHooks();

it('concurrent duplicate callbacks have exactly one balance and turnover effect', async () => {
  const who = await member(); const d = await deposit(who.memberId, '100', 1);
  const responses = await raceOnWallet(who.walletId, [() => callback(d.pspRef), () => callback(d.pspRef)]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  expect(await WalletTx.count()).toBe(1);
  expect((await Wallet.findByPk(who.walletId))!.requiredTurnover).toBe(money('100'));
  await reconcile();
});

it.each(['wager', 'withdrawal'])('concurrent %ss cannot overdraw', async operation => {
  const who = await member(); await fund(who.memberId);
  const call = () => operation === 'wager'
    ? request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '80' })
    : request(app).post('/withdrawals').send({ memberId: who.memberId, amount: '80' });
  const responses = await raceOnWallet(who.walletId, [call, call]);
  expect(responses.map(r => r.status).sort()).toEqual([201, 422]);
  const wallet = await Wallet.findByPk(who.walletId);
  expect(wallet!.balance).toBe(money('20'));
  expect(wallet!.accruedTurnover).toBe(money(operation === 'wager' ? '80' : '0'));
  expect(await WalletTx.count()).toBe(2);
  await reconcile();
});

it('two different deposits on one wallet cannot lose an update', async () => {
  const who = await member(); const a = await deposit(who.memberId, '40', 2); const b = await deposit(who.memberId, '60', 1);
  const responses = await raceOnWallet(who.walletId, [() => callback(a.pspRef, '40'), () => callback(b.pspRef, '60')]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  const wallet = await Wallet.findByPk(who.walletId);
  expect(wallet!.balance).toBe(money('100'));
  expect(wallet!.requiredTurnover).toBe(money('140'));
  await reconcile();
});

it('conflicting concurrent terminal callbacks select one final state', async () => {
  const who = await member(); const d = await deposit(who.memberId);
  const responses = await raceOnWallet(who.walletId, [() => callback(d.pspRef), () => callback(d.pspRef, '100', 'failed')]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  const funding = await FundingTx.findByPk(d.id);
  expect(await WalletTx.count()).toBe(funding!.status === 'Completed' ? 1 : 0);
  await reconcile();
});

it('callback plus wager is equivalent to one valid serial order', async () => {
  const who = await member(); const d = await deposit(who.memberId, '100');
  const [credit, debit] = await raceOnWallet(who.walletId, [() => callback(d.pspRef),
    () => request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '80' })]);
  expect(credit.status).toBe(200);
  expect([201, 422]).toContain(debit.status);
  expect((await Wallet.findByPk(who.walletId))!.balance).toBe(money(debit.status === 201 ? '20' : '100'));
  await reconcile();
});

it('callback plus withdrawal respects turnover at the serialized point', async () => {
  const who = await member(); await fund(who.memberId, '100'); const d = await deposit(who.memberId, '20', 1);
  const [credit, withdrawal] = await raceOnWallet(who.walletId, [() => callback(d.pspRef, '20'),
    () => request(app).post('/withdrawals').send({ memberId: who.memberId, amount: '80' })]);
  expect(credit.status).toBe(200);
  expect([201, 422]).toContain(withdrawal.status);
  expect((await Wallet.findByPk(who.walletId))!.balance).toBe(money(withdrawal.status === 201 ? '40' : '120'));
  await reconcile();
});

it('NO KEY UPDATE permits a Pending funding FK insert while money writes still wait', async () => {
  const who = await member(); await fund(who.memberId);
  const hold = await holdWallet(who.walletId);
  try {
    await request(app).post('/deposits').send({ memberId: who.memberId, amount: '1' }).expect(201);
    await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '1' }).expect(503);
  } finally { await hold.rollback(); }
  expect((await Wallet.findByPk(who.walletId))!.balance).toBe(money('100'));
  await request(app).post('/wallets/' + who.walletId + '/wagers').send({ amount: '1' }).expect(201);
  await reconcile();
});

it('pool saturation expires acquisition and releases capacity afterwards', async () => {
  const held = await Promise.all(Array.from({ length: config.poolMax }, () => sequelize.transaction()));
  try { await request(app).get('/health').expect(503); }
  finally { await Promise.all(held.map(t => t.rollback())); }
  await request(app).get('/health').expect(200);
});

it('SET LOCAL timeouts do not leak through a pooled connection', async () => {
  await sequelize.transaction(async transaction => {
    await sequelize.query("SET LOCAL lock_timeout = '17ms'", { transaction });
    const rows = await sequelize.query<{ lock_timeout: string }>('SHOW lock_timeout', { transaction, type: QueryTypes.SELECT });
    expect(rows[0].lock_timeout).toBe('17ms');
  });
  const rows = await sequelize.query<{ lock_timeout: string }>('SHOW lock_timeout', { type: QueryTypes.SELECT });
  expect(rows[0].lock_timeout).not.toBe('17ms');
});

it('an expired application transaction deadline rolls back its writes', async () => {
  const previous = config.transactionDeadlineMs;
  config.transactionDeadlineMs = 100;
  let inserted = false;
  try {
    await expect(walletTransaction(async t => {
      const { Member } = await import('../src/db/models');
      await Member.create({ username: 'deadline-test' }, { transaction: t });
      inserted = true;
      await new Promise(resolve => setTimeout(resolve, 150)); // Deliberate deadline expiry, not a concurrency barrier.
    })).rejects.toMatchObject({ code: 'transaction_deadline' });
  } finally { config.transactionDeadlineMs = previous; }
  expect(inserted).toBe(true);
  const [rows] = await owner.query("SELECT id FROM members WHERE username='deadline-test'");
  expect(rows).toHaveLength(0);
});
