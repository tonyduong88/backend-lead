'use strict';
const { spawn } = require('node:child_process');
const { connect, preflightTest, settings, safeFailure } = require('./lib/db');

async function main() {
  const dbConfig = settings();
  if (process.env.NODE_ENV === 'test') await preflightTest();
  const db = connect(dbConfig.migration, 'mini-wallet-migration-coordinator', dbConfig.ownerRole);
  let connection;
  try {
    connection = await db.connectionManager.getConnection();
    // Session advisory lock is only for schema coordination, never wallet money locking.
    const { rows } = await connection.query('SELECT pg_try_advisory_lock(77819001) AS acquired');
    if (!rows[0].acquired) throw new Error('Another migration runner is active');
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', ...process.argv.slice(2)], {
        stdio: 'inherit', env: process.env,
      });
      child.on('error', reject);
      child.on('exit', resolve);
    });
    if (code !== 0) throw new Error('Migration CLI failed');
  } finally {
    if (connection) {
      await connection.query('SELECT pg_advisory_unlock(77819001)');
      await db.connectionManager.releaseConnection(connection);
    }
    await db.close();
  }
}
main().catch(safeFailure);
