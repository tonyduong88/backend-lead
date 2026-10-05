'use strict';

const fs = require('node:fs');
const dotenv = require('dotenv');

function loadFiles(paths, accepts) {
  for (const path of paths) {
    if (!fs.existsSync(path)) continue;
    for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(path)))) {
      if (accepts(key) && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

// API startup deliberately never loads owner/admin credentials from local files.
// Explicit environment variables win; the user's .env is never overwritten.
loadFiles(['.env.runtime', '.env'], key =>
  ['NODE_ENV', 'PORT', 'DATABASE_URL', 'DATABASE_URL_TEST', 'TEST_DATABASE_ALLOWLIST', 'MAX_IN_FLIGHT',
    'PSP_MOCK_ENABLED', 'POSTGRES_DATA_VOLUME'].includes(key) || key.startsWith('DB_'));

function loadOperations() {
  loadFiles(['.env.ops', '.env.runtime', '.env'], key =>
    ['ADMIN_DATABASE_URL', 'DATABASE_URL_MIGRATIONS', 'DATABASE_URL_TEST_OWNER', 'PG_CONTAINER'].includes(key));
}

function target(url) {
  const u = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new Error('Expected a PostgreSQL URL');
  const host = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? 'loopback' : u.hostname;
  return { host, port: u.port || '5432', database: decodeURIComponent(u.pathname.slice(1)) };
}

function sameTarget(left, right) {
  return JSON.stringify(target(left)) === JSON.stringify(target(right));
}

function runtimeSettings(test = process.env.NODE_ENV === 'test') {
  const development = process.env.DATABASE_URL || 'postgres://wallet_app:wallet_app_local@localhost:5439/wallet';
  const runtime = test
    ? process.env.DATABASE_URL_TEST || 'postgres://wallet_test_app:wallet_test_app_local@localhost:5439/wallet_test'
    : development;
  if (test) {
    const allowed = (process.env.TEST_DATABASE_ALLOWLIST || 'wallet_test').split(',');
    if (!allowed.includes(target(runtime).database) || sameTarget(runtime, development)) {
      throw new Error('Refusing a test connection outside the isolated test database');
    }
  }
  return {
    runtime, development,
    runtimeRole: test ? 'wallet_test_app' : 'wallet_app',
  };
}

function settings(test = process.env.NODE_ENV === 'test') {
  loadOperations();
  const db = runtimeSettings(test);
  const migration = test
    ? process.env.DATABASE_URL_TEST_OWNER || 'postgres://wallet_test_owner:wallet_test_owner_local@localhost:5439/wallet_test'
    : process.env.DATABASE_URL_MIGRATIONS || 'postgres://wallet_migrator:wallet_migrator_local@localhost:5439/wallet';
  if (!sameTarget(db.runtime, migration)) throw new Error('Runtime and migration must target the same database');
  return { ...db, migration, ownerRole: test ? 'wallet_test_owner' : 'wallet_owner' };
}

function sslOptions(url) {
  const u = new URL(url);
  if (process.env.DB_SSL !== undefined && !['true', 'false'].includes(process.env.DB_SSL)) {
    throw new Error('DB_SSL must be true or false');
  }
  if (['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].some(k => u.searchParams.has(k))) {
    throw new Error('Configure DB_SSL and DB_SSL_CA_FILE instead of URL SSL parameters');
  }
  if (process.env.DB_SSL === 'true') {
    return { ssl: { rejectUnauthorized: true, ...(process.env.DB_SSL_CA_FILE
      ? { ca: fs.readFileSync(process.env.DB_SSL_CA_FILE, 'utf8') } : {}) } };
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Production database requires DB_SSL=true');
  return {};
}

module.exports = { settings, runtimeSettings, loadOperations, target, sameTarget, sslOptions };
