'use strict';
const { spawn } = require('node:child_process');
const { withTestLock } = require('./lib/isolated');
const { safeFailure } = require('./lib/db');

async function run(args) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
    child.on('error', reject); child.on('exit', resolve);
  });
  if (code !== 0) throw new Error('Verification process failed');
}

withTestLock(async () => {
  await run(['scripts/migrate.js']);
  await run([require.resolve('jest/bin/jest'), '--runInBand', ...process.argv.slice(2)]);
}).catch(safeFailure);
