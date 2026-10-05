'use strict';
const { Sequelize, QueryTypes } = require('sequelize');
const { settings, target, sslOptions, loadOperations } = require('../../src/db/settings');
loadOperations();

function connect(url, name, role) {
  return new Sequelize(url, { dialect: 'postgres', logging: false, pool: { max: 2, min: 0 },
    retry: { max: 0 }, dialectOptions: { ...sslOptions(url), application_name: name,
      statement_timeout: 30000, lock_timeout: 3000,
      ...(role ? { options: '-c role=' + role } : {}) } });
}

async function guardTest(db) {
  const config = settings(true);
  const [identity] = await db.query(`SELECT current_database() AS name, current_user AS role,
    r.rolsuper, r.rolcreatedb, r.rolcreaterole,
    shobj_description(d.oid, 'pg_database') AS marker,
    has_database_privilege(current_user, $dev, 'CONNECT') AS can_dev
    FROM pg_database d JOIN pg_roles r ON r.rolname = current_user
    WHERE d.datname = current_database()`, {
    bind: { dev: target(config.development).database }, type: QueryTypes.SELECT,
  });
  if (!identity || identity.name !== target(config.runtime).database || identity.role !== 'wallet_test_owner'
    || identity.rolsuper || identity.rolcreatedb || identity.rolcreaterole || identity.can_dev
    || identity.marker !== 'mini-wallet isolated test database') {
    throw new Error('Refusing test migration/cleanup: database identity, role isolation or marker is invalid');
  }
  return identity;
}

async function preflightTest() {
  const config = settings(true);
  const db = connect(config.migration, 'mini-wallet-test-preflight');
  try { await guardTest(db); } finally { await db.close(); }
}

function safeFailure(error) {
  // Avoid Sequelize's error.message/sql/parameters and URLs in operational output.
  console.error('Operation failed:', error.original?.code ?? error.code ?? error.name,
    error.original ? '(database error; inspect the scoped operation)' : error.message);
  process.exitCode = 1;
}

module.exports = { connect, guardTest, preflightTest, settings, target, safeFailure };
