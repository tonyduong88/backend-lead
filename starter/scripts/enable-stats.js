'use strict';
const { connect, settings, target, safeFailure } = require('./lib/db');

async function main() {
  if (!process.env.ADMIN_DATABASE_URL || target(process.env.ADMIN_DATABASE_URL).host !== 'loopback') {
    throw new Error('Statistics setup requires explicit local ADMIN_DATABASE_URL');
  }
  for (const test of [false, true]) {
    const config = settings(test);
    if (target(config.runtime).host !== 'loopback') throw new Error('Local statistics setup only');
    const url = new URL(process.env.ADMIN_DATABASE_URL);
    if (target(url.toString()).port !== target(config.runtime).port) throw new Error('Admin/runtime server mismatch');
    url.pathname = '/' + target(config.runtime).database;
    const db = connect(url.toString(), 'mini-wallet-stats-setup');
    try {
      await db.query('CREATE SCHEMA IF NOT EXISTS monitoring');
      await db.query('REVOKE CREATE ON SCHEMA monitoring FROM PUBLIC');
      await db.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA monitoring');
      await db.query('GRANT USAGE ON SCHEMA monitoring TO ' + config.runtimeRole);
      await db.query('SELECT count(*) FROM monitoring.pg_stat_statements');
      console.log('SQL statistics enabled:', target(config.runtime).database);
    } finally { await db.close(); }
  }
}
main().catch(safeFailure);
