import { z } from 'zod';
import { runtimeSettings } from './db/settings';

const env = process.env.NODE_ENV ?? 'development';
const positive = (key: string, fallback: number) => z.coerce.number().int().positive().parse(process.env[key] ?? fallback);
const database = runtimeSettings(env === 'test');

export const config = {
  env,
  port: positive('PORT', 3000),
  databaseUrl: database.runtime,
  runtimeRole: database.runtimeRole,
  poolMax: positive('DB_POOL_MAX', 5),
  poolAcquireMs: positive('DB_POOL_ACQUIRE_MS', 3000),
  poolIdleMs: positive('DB_POOL_IDLE_MS', 10000),
  lockTimeoutMs: positive('DB_LOCK_TIMEOUT_MS', 1500),
  statementTimeoutMs: positive('DB_STATEMENT_TIMEOUT_MS', 5000),
  idleTransactionTimeoutMs: positive('DB_IDLE_TRANSACTION_TIMEOUT_MS', 10000),
  transactionDeadlineMs: positive('DB_TRANSACTION_DEADLINE_MS', 15000),
  maxInFlight: positive('MAX_IN_FLIGHT', 64),
  applicationName: process.env.DB_APPLICATION_NAME ?? 'mini-wallet-' + env,
  mockPspEnabled: z.enum(['true', 'false']).default('true').parse(process.env.PSP_MOCK_ENABLED) === 'true',
};

if (config.lockTimeoutMs >= config.statementTimeoutMs) {
  throw new Error('DB_LOCK_TIMEOUT_MS must be lower than DB_STATEMENT_TIMEOUT_MS');
}
if (env === 'production' && config.mockPspEnabled) {
  throw new Error('Disable the unsigned mock PSP in production');
}
