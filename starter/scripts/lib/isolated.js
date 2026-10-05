'use strict';
const { randomUUID } = require('node:crypto');
const { connect, settings, target, guardTest } = require('./db');

async function withTestLock(work) {
  const db = connect(settings(true).migration, 'mini-wallet-test-coordinator');
  let connection;
  try {
    await guardTest(db);
    connection = await db.connectionManager.getConnection();
    const { rows } = await connection.query('SELECT pg_try_advisory_lock(77819002) AS acquired');
    if (!rows[0].acquired) throw new Error('Tests/benchmark/restore verification already use this test database');
    return await work(db);
  } finally {
    if (connection) {
      await connection.query('SELECT pg_advisory_unlock(77819002)');
      await db.connectionManager.releaseConnection(connection);
    }
    await db.close();
  }
}

async function withScratchDatabase(purpose, work) {
  if (!['restore', 'verify'].includes(purpose)) throw new Error('Invalid scratch purpose');
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (!adminUrl || target(adminUrl).host !== 'loopback') throw new Error('Scratch databases require an explicit local ADMIN_DATABASE_URL');
  const name = 'wallet_' + purpose + '_' + randomUUID().replace(/-/g, '');
  const admin = connect(adminUrl, 'mini-wallet-scratch-admin');
  const config = settings(true);
  const ownerUrl = new URL(config.migration); ownerUrl.pathname = '/' + name;
  const runtimeUrl = new URL(config.runtime); runtimeUrl.pathname = '/' + name;
  let created = false;
  try {
    await admin.query('CREATE DATABASE "' + name + '" OWNER wallet_test_owner'); created = true;
    await admin.query('REVOKE ALL ON DATABASE "' + name + '" FROM PUBLIC');
    await admin.query('GRANT CONNECT ON DATABASE "' + name + '" TO wallet_test_app');
    await admin.query('COMMENT ON DATABASE "' + name + '" IS ' + admin.escape('mini-wallet isolated test database'));
    return await work({ name, ownerUrl: ownerUrl.toString(), runtimeUrl: runtimeUrl.toString(), admin });
  } finally {
    // Only the exact random database created by this invocation is eligible for cleanup.
    if (created) await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)');
    await admin.close();
  }
}

module.exports = { withTestLock, withScratchDatabase };
