import request from 'supertest';
import { get } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { sequelize } from '../src/db/sequelize';
import { Member, WalletTx } from '../src/db/models';
import { mockAdapter } from '../src/integrations/psp/mockAdapter';
import { walletTransaction } from '../src/services/walletMutation';
import { callback, databaseHooks, deposit, member, reconcile, waitUntil } from './helpers/database';

databaseHooks();

it('passes exact HTTP bytes to the adapter before JSON parsing', async () => {
  const who = await member(); const d = await deposit(who.memberId, '0.100000000000000001');
  const raw = '{\n  "status" : "completed", "pspRef": "' + d.pspRef + '", "amount":"0.100000000000000001"\n}';
  const verify = jest.spyOn(mockAdapter, 'verifyAndNormalize');
  await request(createApp()).post('/psp/callbacks').set('content-type', 'application/json').send(raw).expect(200);
  expect(verify.mock.calls[0][0].rawBody.equals(Buffer.from(raw))).toBe(true);
  await reconcile();
});

it('replay on a new application instance still relies on durable funding identity', async () => {
  const who = await member(); const d = await deposit(who.memberId);
  await callback(d.pspRef).expect(200);
  await request(createApp()).post('/psp/callbacks').send({ pspRef: d.pspRef, amount: '100', status: 'completed' }).expect(200);
  expect(await WalletTx.count()).toBe(1);
  await reconcile();
});

it('keeps admission capacity occupied until work settles after a client disconnect', async () => {
  const limit = config.maxInFlight; config.maxInFlight = 1;
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  jest.spyOn(sequelize, 'authenticate').mockImplementationOnce(async () => { enter(); await gate; });
  const address = server.address() as { port: number };
  const client = get('http://127.0.0.1:' + address.port + '/health');
  client.on('error', () => {});
  try {
    await entered;
    client.destroy();
    await request(server).get('/health').expect(503);
    release();
    await waitUntil(async () => (await request(server).get('/health')).status === 200);
  } finally {
    release(); client.destroy(); config.maxInFlight = limit;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('retries the whole transaction after a retryable failure without retaining partial writes', async () => {
  let attempts = 0;
  await walletTransaction(async t => {
    attempts++;
    await Member.create({ username: 'retry-member' }, { transaction: t });
    if (attempts === 1) throw { original: { code: '40001' } }; // Inject after a real write.
  });
  expect(attempts).toBe(2);
  expect(await Member.count({ where: { username: 'retry-member' } })).toBe(1);
});

it('runtime configuration does not load local admin or migration credentials', () => {
  const env = { ...process.env };
  for (const key of ['ADMIN_DATABASE_URL', 'DATABASE_URL_MIGRATIONS', 'DATABASE_URL_TEST_OWNER']) delete env[key];
  const output = execFileSync(process.execPath, ['-e', `
    require('./src/db/settings').runtimeSettings();
    const keys = ['ADMIN_DATABASE_URL','DATABASE_URL_MIGRATIONS','DATABASE_URL_TEST_OWNER'];
    process.stdout.write(JSON.stringify(keys.every(key => process.env[key] === undefined)));
  `], { env, encoding: 'utf8' });
  expect(output).toBe('true');
});
