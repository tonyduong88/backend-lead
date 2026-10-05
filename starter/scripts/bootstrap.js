'use strict';
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { QueryTypes } = require('sequelize');
const { connect, target, safeFailure } = require('./lib/db');

const identifier = name => '"' + name.replace(/"/g, '""') + '"';

async function main() {
  const adminUrl = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL || 'postgres://wallet:wallet@localhost:5439/wallet';
  if (target(adminUrl).host !== 'loopback' || target(adminUrl).database !== 'wallet') {
    throw new Error('This bootstrap is local-only for wallet/wallet_test. Use the runbook for remote provisioning.');
  }
  const admin = connect(adminUrl, 'mini-wallet-bootstrap');
  const [identity] = await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user', { type: QueryTypes.SELECT });
  if (!identity.rolsuper) throw new Error('Set ADMIN_DATABASE_URL to the local bootstrap administrator');
  const runtimeFile = '.env.runtime';
  const parse = path => fs.existsSync(path) ? require('dotenv').parse(fs.readFileSync(path)) : {};
  const existing = { ...parse(runtimeFile), ...parse('.env.ops') };
  const credentials = {};
  const urls = {};
  const roles = {
    wallet_app: ['DATABASE_URL', 'wallet'],
    wallet_migrator: ['DATABASE_URL_MIGRATIONS', 'wallet'],
    wallet_test_app: ['DATABASE_URL_TEST', 'wallet_test'],
    wallet_test_owner: ['DATABASE_URL_TEST_OWNER', 'wallet_test'],
  };
  try {
    for (const [role, [key, database]] of Object.entries(roles)) {
      const url = new URL(existing[key] || adminUrl);
      const password = existing[key] ? decodeURIComponent(url.password) : randomBytes(24).toString('hex');
      url.username = role; url.password = password; url.pathname = '/' + database;
      urls[key] = url.toString(); credentials[role] = password;
    }
    for (const role of ['wallet_owner', ...Object.keys(roles)]) {
      const found = await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$role', { bind: { role }, type: QueryTypes.SELECT });
      if (!found.length) await admin.query('CREATE ROLE ' + identifier(role));
      await admin.query('ALTER ROLE ' + identifier(role) + ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS ' +
        (role === 'wallet_owner' ? 'NOLOGIN' : 'LOGIN PASSWORD ' + admin.escape(credentials[role])));
    }
    await admin.query('GRANT wallet_owner TO wallet_migrator');
    for (const [name, owner] of [['wallet', 'wallet_owner'], ['wallet_test', 'wallet_test_owner']]) {
      const found = await admin.query('SELECT 1 FROM pg_database WHERE datname=$name', { bind: { name }, type: QueryTypes.SELECT });
      if (!found.length) await admin.query('CREATE DATABASE ' + identifier(name) + ' OWNER ' + identifier(owner));
      await admin.query('ALTER DATABASE ' + identifier(name) + ' OWNER TO ' + identifier(owner));
      await admin.query('REVOKE ALL ON DATABASE ' + identifier(name) + ' FROM PUBLIC');
      const app = name === 'wallet' ? 'wallet_app' : 'wallet_test_app';
      await admin.query('GRANT CONNECT ON DATABASE ' + identifier(name) + ' TO ' + identifier(app));
      if (name === 'wallet') await admin.query('GRANT CONNECT ON DATABASE wallet TO wallet_migrator');
      else await admin.query("COMMENT ON DATABASE wallet_test IS 'mini-wallet isolated test database'");
      const url = new URL(adminUrl); url.pathname = '/' + name;
      const local = connect(url.toString(), 'mini-wallet-bootstrap-schema');
      try {
        await local.transaction(async transaction => {
          await local.query('ALTER SCHEMA public OWNER TO ' + identifier(owner), { transaction });
          await local.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC', { transaction });
          await local.query('GRANT USAGE ON SCHEMA public TO ' + identifier(app), { transaction });
          // Adopt only this starter's known tables; never REASSIGN OWNED across the cluster.
          for (const table of ['members', 'wallets', 'SequelizeMeta', 'funding_txs', 'wallet_txs']) {
            const exists = await local.query('SELECT to_regclass($name) AS name', {
              bind: { name: 'public.' + identifier(table) }, transaction, type: QueryTypes.SELECT,
            });
            if (exists[0].name) await local.query('ALTER TABLE public.' + identifier(table) + ' OWNER TO ' + identifier(owner), { transaction });
          }
        });
      } finally { await local.close(); }
    }
    let volume = existing.POSTGRES_DATA_VOLUME || process.env.POSTGRES_DATA_VOLUME;
    if (!volume) {
      try {
        const mounts = JSON.parse(execFileSync('docker', ['inspect', process.env.PG_CONTAINER || 'starter-postgres-1',
          '--format', '{{json .Mounts}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
        volume = mounts.find(m => m.Destination === '/var/lib/postgresql/data' && m.Type === 'volume')?.Name;
      } catch { /* db:up will require explicit adoption if a running legacy container exists. */ }
    }
    const runtime = { ...parse(runtimeFile), DATABASE_URL: urls.DATABASE_URL, DATABASE_URL_TEST: urls.DATABASE_URL_TEST,
      ...(volume ? { POSTGRES_DATA_VOLUME: volume } : {}) };
    delete runtime.ADMIN_DATABASE_URL; delete runtime.DATABASE_URL_MIGRATIONS; delete runtime.DATABASE_URL_TEST_OWNER;
    const operations = { ...parse('.env.ops'), ADMIN_DATABASE_URL: adminUrl,
      DATABASE_URL_MIGRATIONS: urls.DATABASE_URL_MIGRATIONS, DATABASE_URL_TEST_OWNER: urls.DATABASE_URL_TEST_OWNER };
    for (const [path, values] of [[runtimeFile, runtime], ['.env.ops', operations]]) {
      fs.writeFileSync(path, Object.entries(values).map(([k, v]) => k + '=' + v).join('\n') + '\n', { mode: 0o600 });
      fs.chmodSync(path, 0o600);
    }
    console.log('Local roles/databases provisioned; .env preserved. Runtime and operations credentials are separated.');
  } finally { await admin.close(); }
}
main().catch(safeFailure);
