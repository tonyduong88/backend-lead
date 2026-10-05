import { Sequelize } from 'sequelize';
import { config } from '../config';
import { sslOptions } from './settings';
import { observe } from '../lib/metrics';
import { performance } from 'node:perf_hooks';

const acquireStarted = new WeakMap<object, number>();

export const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  benchmark: true,
  logging: (_sql, elapsed) => { if (typeof elapsed === 'number') observe('sql', elapsed); },
  pool: { max: config.poolMax, min: 0, acquire: config.poolAcquireMs, idle: config.poolIdleMs },
  dialectOptions: {
    ...sslOptions(config.databaseUrl),
    application_name: config.applicationName,
    statement_timeout: config.statementTimeoutMs,
    lock_timeout: config.lockTimeoutMs,
    idle_in_transaction_session_timeout: config.idleTransactionTimeoutMs,
  },
  retry: { max: 0 },
  hooks: {
    beforePoolAcquire: options => { acquireStarted.set(options, performance.now()); },
    afterPoolAcquire: (_connection, options) => {
      const started = acquireStarted.get(options);
      if (started !== undefined) observe('poolWait', performance.now() - started);
      acquireStarted.delete(options);
    },
  },
  define: { underscored: true },
});

export async function assertRuntimeRole(): Promise<void> {
  const [rows] = await sequelize.query(
    'SELECT current_user AS name, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls ' +
    'FROM pg_roles WHERE rolname = current_user',
  );
  const role = rows[0] as Record<string, unknown>;
  if (role.name !== config.runtimeRole || ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolreplication', 'rolbypassrls'].some(k => role[k])) {
    throw new Error('API must use its restricted runtime role; run db:bootstrap and check connection configuration');
  }
  const [owned] = await sequelize.query(
    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname='public' AND pg_has_role(current_user, c.relowner, 'MEMBER') LIMIT 1",
  );
  if (owned.length) throw new Error('Runtime role must not own or inherit ownership of application objects');
}
