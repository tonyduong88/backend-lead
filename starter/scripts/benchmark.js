'use strict';
const fs = require('node:fs');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { withTestLock } = require('./lib/isolated');
const { connect, settings, guardTest, safeFailure } = require('./lib/db');
const { reconcile } = require('./lib/reconcile');
const { diagnostics } = require('./lib/diagnostics');
const { createApp } = require('../dist/app');
const { sequelize, assertRuntimeRole } = require('../dist/db/sequelize');
const { config } = require('../dist/config');
const { metricsSnapshot } = require('../dist/lib/metrics');

function integer(key, fallback, max) {
  const value = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid ' + key);
  return value;
}
const count = integer('BENCH_REQUESTS', 180, 10000);
const concurrency = integer('BENCH_CONCURRENCY', 12, 64);
const largeLedger = integer('BENCH_LEDGER_ROWS', 1000, 100000);
const label = process.env.BENCH_LABEL || 'pool-' + config.poolMax;
if (!/^[a-z0-9-]{1,40}$/.test(label)) throw new Error('Invalid BENCH_LABEL');

async function parallel(items, work) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const i = cursor++; await work(items[i], i); }
  }));
}
const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];

withTestLock(async owner => {
  let server;
  const observer = connect(settings(true).runtime, 'mini-wallet-benchmark-observer');
  try {
    await assertRuntimeRole();
    await guardTest(owner);
    await owner.query('TRUNCATE wallet_txs,funding_txs,wallets,members CASCADE');
    server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const post = async (path, body) => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      return { status: response.status, data };
    };
    const requireSuccess = result => {
      if (result.status >= 400) throw new Error('Fixture failed: ' + result.status + ' ' + result.data.error);
      return result.data;
    };
    const members = [];
    for (let i = 0; i < 20; i++) {
      const member = requireSuccess(await post('/members', { username: 'bench-' + i }));
      members.push(member);
      const deposit = requireSuccess(await post('/deposits', { memberId: member.member.id, amount: '1000000', turnoverMultiplier: 0 }));
      requireSuccess(await post('/psp/callbacks', { pspRef: deposit.pspRef, amount: '1000000', status: 'completed' }));
    }
    // Fixed warm-up and a larger ledger are generated through the same runtime API.
    await parallel(Array.from({ length: largeLedger }), async (_, i) => {
      requireSuccess(await post('/wallets/' + members[i % members.length].wallet.id + '/wagers', { amount: '0.000000000000000001' }));
    });
    await owner.query('ANALYZE wallets');
    await owner.query('ANALYZE funding_txs');
    await owner.query('ANALYZE wallet_txs');
    const workloads = [];
    async function measure(name, operation) {
      const latency = [], codes = {};
      const ledgerBefore = await reconcile(owner);
      const before = metricsSnapshot();
      let sampling = true, samples = 0, blockedSum = 0, maxBlocked = 0;
      const sample = (async () => {
        while (sampling) {
          const [rows] = await observer.query(`SELECT count(*)::int AS blocked FROM pg_stat_activity
            WHERE datname=current_database() AND usename=current_user AND wait_event_type='Lock'`);
          samples++; blockedSum += rows[0].blocked; maxBlocked = Math.max(maxBlocked, rows[0].blocked);
          if (sampling) await new Promise(resolve => setTimeout(resolve, 25));
        }
      })();
      const start = performance.now();
      let durationMs;
      try {
        await parallel(Array.from({ length: count }), async (_, i) => {
          const begin = performance.now();
          const response = await operation(i);
          latency.push(performance.now() - begin);
          const code = response.status + (response.data.error ? ':' + response.data.error : '');
          codes[code] = (codes[code] || 0) + 1;
        });
        durationMs = performance.now() - start;
      } finally { sampling = false; await sample; }
      latency.sort((a, b) => a - b);
      const metrics = metricsSnapshot(), metricDelta = {};
      for (const [key, value] of Object.entries(metrics)) {
        const n = value.count - (before[key]?.count || 0);
        metricDelta[key] = { count: n, meanMs: n ? (value.totalMs - (before[key]?.totalMs || 0)) / n : 0 };
      }
      const successful = Object.entries(codes).filter(([code]) => /^[23]/.test(code)).reduce((n, [, v]) => n + v, 0);
      const ledger = await reconcile(owner);
      workloads.push({ name, requests: count, durationMs, successful, acknowledgementsPerSecond: successful * 1000 / durationMs,
        newMonetaryEffects: ledger.ledger - ledgerBefore.ledger,
        monetaryEffectsPerSecond: (ledger.ledger - ledgerBefore.ledger) * 1000 / durationMs,
        p50Ms: percentile(latency, .5), p95Ms: percentile(latency, .95), p99Ms: percentile(latency, .99), codes,
        metricDelta, lockSamples: { samples, meanBlocked: blockedSum / samples, maxBlocked }, ledger });
      if (successful !== count) throw new Error('Benchmark saw errors in ' + name);
    }
    await measure('distributed-wagers', i => post('/wallets/' + members[i % members.length].wallet.id + '/wagers', { amount: '0.01' }));
    await measure('hot-wallet-wagers', () => post('/wallets/' + members[0].wallet.id + '/wagers', { amount: '0.01' }));
    const duplicate = requireSuccess(await post('/deposits', { memberId: members[0].member.id, amount: '1', turnoverMultiplier: 0 }));
    await measure('duplicate-callbacks', () => post('/psp/callbacks', { pspRef: duplicate.pspRef, amount: '1', status: 'completed' }));
    const pending = [];
    for (let i = 0; i < count; i += 3) pending.push(requireSuccess(await post('/deposits', {
      memberId: members[i % members.length].member.id, amount: '1', turnoverMultiplier: 0,
    })));
    await measure('mixed', i => i % 3 === 0
      ? post('/psp/callbacks', { pspRef: pending[i / 3].pspRef, amount: '1', status: 'completed' })
      : i % 3 === 1 ? post('/wallets/' + members[i % members.length].wallet.id + '/wagers', { amount: '0.01' })
        : post('/withdrawals', { memberId: members[i % members.length].member.id, amount: '0.01' }));
    for (const table of ['wallets', 'funding_txs', 'wallet_txs']) await owner.query('ANALYZE ' + table);
    const report = { label, capturedAt: new Date().toISOString(), node: process.version,
      sequelize: require('sequelize/package.json').version, machine: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem() },
      pool: config.poolMax, concurrency, wallets: members.length, warmupLedgerRows: largeLedger,
      workloads, diagnostics: await diagnostics(observer),
      limitations: 'Short local closed-loop sample, not production capacity. Duplicate ACK/s is not new monetary commits/s. Lock samples measure blocked sessions, not exact lock latency. Metric means are not percentiles.' };
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/benchmark-' + label + '.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ label, workloads }, null, 2));
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await observer.close();
    await sequelize.close();
  }
}).catch(safeFailure);
