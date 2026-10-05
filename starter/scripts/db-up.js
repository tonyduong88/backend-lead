'use strict';
require('../src/db/settings');
const { execFileSync } = require('node:child_process');
const volume = process.env.POSTGRES_DATA_VOLUME || 'mini-wallet-data';
const container = process.env.PG_CONTAINER || 'starter-postgres-1';
let existing;
try {
  existing = JSON.parse(execFileSync('docker', ['inspect', container, '--format', '{{json .Mounts}}'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch { /* New local installation. */ }
const old = existing?.find(m => m.Destination === '/var/lib/postgresql/data');
if (old && (old.Type !== 'volume' || old.Name !== volume)) {
  console.error('Existing PostgreSQL storage differs. Run db:bootstrap to adopt it, or set POSTGRES_DATA_VOLUME after backing it up.');
  process.exit(1);
}
execFileSync('docker', ['volume', 'create', volume], { stdio: 'ignore' });
execFileSync('docker', ['compose', 'up', '-d', '--wait', 'postgres'], { stdio: 'inherit', env: { ...process.env, POSTGRES_DATA_VOLUME: volume } });
