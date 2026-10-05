import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../src/db/sequelize';
import { databaseErrorCode } from '../src/lib/errors';
import { FundingTx, WalletTx } from '../src/db/models';
import { databaseHooks, fund, member, owner, reconcile } from './helpers/database';
const { settings } = require('../src/db/settings');
const { guardTest } = require('../scripts/lib/db');

databaseHooks();

async function expectSqlState(action: Promise<unknown>, code: string) {
  try { await action; throw new Error('Expected SQL to fail'); }
  catch (error) { expect(databaseErrorCode(error)).toBe(code); }
}

it('uses restricted runtime credentials; test owner cannot connect to development', async () => {
  const rows = await sequelize.query<{ name: string; rolsuper: boolean; can_dev: boolean }>(
    "SELECT current_user AS name, rolsuper, has_database_privilege(current_user,'wallet','CONNECT') AS can_dev FROM pg_roles WHERE rolname=current_user",
    { type: QueryTypes.SELECT });
  expect(rows[0]).toMatchObject({ name: 'wallet_test_app', rolsuper: false, can_dev: false });
  await guardTest(owner);
  await expectSqlState(sequelize.query('SET ROLE wallet_test_owner'), '42501');
  await expectSqlState(sequelize.query('SET ROLE wallet_owner'), '42501');
});

it('refuses test configuration pointing to the dev database even through a loopback alias', () => {
  const old = process.env.DATABASE_URL_TEST;
  const oldOwner = process.env.DATABASE_URL_TEST_OWNER;
  const url = new URL(settings(false).development); url.hostname = '127.0.0.1';
  process.env.DATABASE_URL_TEST = url.toString(); process.env.DATABASE_URL_TEST_OWNER = url.toString();
  try { expect(() => settings(true)).toThrow('Refusing a test connection'); }
  finally { process.env.DATABASE_URL_TEST = old; process.env.DATABASE_URL_TEST_OWNER = oldOwner; }
});

it('runtime may read/append ledger but cannot mutate history, identifiers, or schema', async () => {
  const who = await member(); const d = await fund(who.memberId);
  const queries = [
    "UPDATE wallet_txs SET operation_key='changed'",
    'DELETE FROM wallet_txs', 'TRUNCATE wallet_txs',
    "UPDATE funding_txs SET amount='1'",
    "UPDATE funding_txs SET psp_ref='changed'",
    'UPDATE funding_txs SET wallet_id=wallet_id',
    'UPDATE wallets SET member_id=member_id',
    'ALTER TABLE wallet_txs DISABLE TRIGGER ledger_append_only',
    'DROP TABLE wallet_txs', 'CREATE TABLE public.unauthorized_table(id integer)',
  ];
  for (const sql of queries) await expectSqlState(sequelize.query(sql), '42501');
  expect((await FundingTx.findByPk(d.id))!.status).toBe('Completed');
  await reconcile();
});

it('ledger trigger protects history even when a test owner has UPDATE/DELETE privileges', async () => {
  const who = await member(); await fund(who.memberId);
  await expectSqlState(owner.query("UPDATE wallet_txs SET operation_key='changed'"), '55000');
  await expectSqlState(owner.query('DELETE FROM wallet_txs'), '55000');
  await reconcile();
});

it.each(['-1', 'NaN'])('database refuses invalid stored wallet money %s', async value => {
  const who = await member();
  await expectSqlState(owner.query('UPDATE wallets SET balance=$value WHERE id=$id', { bind: { value, id: who.walletId } }), '23514');
  await reconcile();
});

it('ledger uniqueness is independent of the application operation-key generator', async () => {
  const who = await member(); const d = await fund(who.memberId);
  const entry = (await WalletTx.findOne({ where: { fundingTxId: d.id } }))!;
  await expectSqlState(WalletTx.create({ ...entry.get(), id: randomUUID(), operationKey: 'wrong-generated-key' }), '23505');
  await expectSqlState(WalletTx.create({ ...entry.get(), id: randomUUID(), fundingTxId: null, kind: 'WagerDebit',
    delta: '-1', requiredTurnoverDelta: '0', accruedTurnoverDelta: '1' }), '23505');
  await reconcile();
});

it('composite FK prevents attaching one wallet funding to another wallet ledger', async () => {
  const first = await member(); const second = await member(); const d = await fund(first.memberId);
  await expectSqlState(WalletTx.create({ walletId: second.walletId, fundingTxId: d.id,
    kind: 'WithdrawalDebit', operationKey: 'wrong-wallet', delta: '-1', requiredTurnoverDelta: '0', accruedTurnoverDelta: '0' }), '23503');
  await reconcile();
});

it('CHECK constraints reject inconsistent ledger effects and nulls', async () => {
  const who = await member();
  await expectSqlState(owner.query(`INSERT INTO wallet_txs(wallet_id,kind,operation_key,delta,accrued_turnover_delta)
    VALUES ($id,'WagerDebit','bad-turnover',-1,2)`, { bind: { id: who.walletId } }), '23514');
  await expectSqlState(owner.query(`INSERT INTO wallet_txs(wallet_id,kind,operation_key,delta)
    VALUES ($id,'WagerDebit','bad-null',NULL)`, { bind: { id: who.walletId } }), '23502');
  await reconcile();
});

it('financial tables are logged and database durability remains enabled', async () => {
  const rows = await owner.query<{ relpersistence: string }>(
    "SELECT relpersistence FROM pg_class WHERE oid IN ('wallets'::regclass,'funding_txs'::regclass,'wallet_txs'::regclass)",
    { type: QueryTypes.SELECT });
  expect(rows.map(r => r.relpersistence)).toEqual(['p', 'p', 'p']);
  for (const name of ['fsync', 'full_page_writes', 'synchronous_commit']) {
    const result = await owner.query<{ value: string }>('SELECT current_setting($name) AS value', {
      bind: { name }, type: QueryTypes.SELECT });
    expect(result[0].value).toBe('on');
  }
});
