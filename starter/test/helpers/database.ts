import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { QueryTypes, Sequelize, Transaction } from 'sequelize';
import { createApp } from '../../src/app';
import { assertRuntimeRole, sequelize } from '../../src/db/sequelize';
import { FundingTx, Wallet, WalletTx } from '../../src/db/models';
import { config } from '../../src/config';
import { dec, money, ZERO } from '../../src/lib/money';
const { connect, guardTest, settings } = require('../../scripts/lib/db');

export const app = createApp();
export const owner: Sequelize = connect(settings(true).migration, 'mini-wallet-test-owner');

export function databaseHooks(): void {
  beforeAll(async () => { await guardTest(owner); await assertRuntimeRole(); });
  beforeEach(async () => {
    await guardTest(owner);
    await owner.query('TRUNCATE wallet_txs, funding_txs, wallets, members');
  });
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(async () => { await sequelize.close(); await owner.close(); });
}

export async function member() {
  const response = await request(app).post('/members').send({ username: 'test-' + randomUUID() });
  expect(response.status).toBe(201);
  return { memberId: response.body.member.id as string, walletId: response.body.wallet.id as string };
}

export async function deposit(memberId: string, amount = '100', turnoverMultiplier = 0) {
  const response = await request(app).post('/deposits').send({ memberId, amount, turnoverMultiplier });
  expect(response.status).toBe(201);
  return response.body as { id: string; pspRef: string; status: string };
}

export function callback(pspRef: string, amount = '100', status = 'completed') {
  return request(app).post('/psp/callbacks').send({ pspRef, amount, status });
}

export async function fund(memberId: string, amount = '100', multiplier = 0) {
  const funding = await deposit(memberId, amount, multiplier);
  expect((await callback(funding.pspRef, amount)).status).toBe(200);
  return funding;
}

export async function reconcile(): Promise<void> {
  await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ, readOnly: true }, async t => {
    for (const wallet of await Wallet.findAll({ transaction: t })) {
      const entries = await WalletTx.findAll({ where: { walletId: wallet.id }, transaction: t });
      const total = (key: 'delta' | 'requiredTurnoverDelta' | 'accruedTurnoverDelta') =>
        money(entries.reduce((sum, row) => sum.plus(dec(row[key])), ZERO));
      expect(wallet.balance).toBe(total('delta'));
      expect(wallet.requiredTurnover).toBe(total('requiredTurnoverDelta'));
      expect(wallet.accruedTurnover).toBe(total('accruedTurnoverDelta'));
      expect(dec(wallet.balance).gte(ZERO)).toBe(true);
    }
    for (const funding of await FundingTx.findAll({ transaction: t })) {
      const count = await WalletTx.count({ where: { fundingTxId: funding.id }, transaction: t });
      expect(count).toBe(funding.type === 'Withdrawal' || funding.status === 'Completed' ? 1 : 0);
    }
  });
}

export async function waitUntil(check: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('Expected database blocking state was not observed');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function holdWallet(walletId: string): Promise<Transaction> {
  const t = await owner.transaction();
  await owner.query('SELECT id FROM wallets WHERE id=$id FOR NO KEY UPDATE', { bind: { id: walletId }, transaction: t });
  return t;
}

export async function raceOnWallet<T>(walletId: string, calls: Array<() => PromiseLike<T>>): Promise<T[]> {
  const hold = await holdWallet(walletId);
  const pending = calls.map(call => Promise.resolve(call()));
  let released = false;
  try {
    await waitUntil(async () => {
      const rows = await owner.query<{ blocked: string }>(
        'SELECT count(*) AS blocked FROM pg_stat_activity WHERE datname=current_database() ' +
        'AND usename=$role AND cardinality(pg_blocking_pids(pid)) > 0',
        { bind: { role: config.runtimeRole }, type: QueryTypes.SELECT },
      );
      return Number(rows[0].blocked) >= calls.length; // Count, never money.
    });
    await hold.rollback(); released = true;
    return await Promise.all(pending);
  } finally {
    if (!released) await hold.rollback();
    await Promise.allSettled(pending);
  }
}
