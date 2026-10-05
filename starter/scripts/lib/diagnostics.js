'use strict';
const { QueryTypes } = require('sequelize');

async function diagnostics(db) {
  const select = sql => db.query(sql, { type: QueryTypes.SELECT });
  const configuration = await select(`SELECT name, setting, unit FROM pg_settings WHERE name IN
    ('server_version','max_connections','shared_buffers','work_mem','autovacuum','fsync',
     'full_page_writes','synchronous_commit','shared_preload_libraries','compute_query_id') ORDER BY name`);
  const tables = await select(`SELECT relname,n_live_tup,n_dead_tup,n_tup_upd,n_tup_hot_upd,
    last_autovacuum,last_autoanalyze FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname`);
  const indexes = await select(`SELECT indexrelname,idx_scan,idx_tup_read,idx_tup_fetch
    FROM pg_stat_user_indexes WHERE schemaname='public' ORDER BY indexrelname`);
  const io = await select('SELECT backend_type,object,context,reads,writes,hits,evictions FROM pg_stat_io');
  const [wallet] = await select('SELECT id FROM wallets ORDER BY id LIMIT 1');
  const [funding] = await select("SELECT provider,psp_ref FROM funding_txs WHERE type='Deposit' ORDER BY id LIMIT 1");
  const plans = {};
  if (wallet) {
    plans.wallet = await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM wallets WHERE id=$id',
      { bind: { id: wallet.id }, type: QueryTypes.SELECT });
    plans.ledger = await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM wallet_txs WHERE wallet_id=$id ORDER BY created_at,id LIMIT 50',
      { bind: { id: wallet.id }, type: QueryTypes.SELECT });
  }
  if (funding) plans.funding = await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM funding_txs WHERE provider=$provider AND psp_ref=$ref',
    { bind: { provider: funding.provider, ref: funding.psp_ref }, type: QueryTypes.SELECT });
  const [extension] = await select("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements') AS enabled");
  const statements = extension.enabled ? await select(`SELECT queryid,calls,total_exec_time,mean_exec_time,
    rows,shared_blks_hit,shared_blks_read FROM monitoring.pg_stat_statements
    WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND userid=(SELECT oid FROM pg_roles WHERE rolname=current_user)
    ORDER BY total_exec_time DESC LIMIT 20`) : [];
  return { configuration, tables, indexes, io, plans, statements,
    statisticsScope: 'Cumulative DB/cluster counters; statement statistics restricted to current runtime role. No SQL text or binds.' };
}
module.exports = { diagnostics };
