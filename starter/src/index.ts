import { createApp } from './app';
import { config } from './config';
import { assertRuntimeRole, sequelize } from './db/sequelize';

async function main() {
  await sequelize.authenticate();
  await assertRuntimeRole();
  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`mini-wallet-service listening on :${config.port}`);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void sequelize.close().then(() => process.exit(0)); });
    setTimeout(() => { process.exit(1); }, 30000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch(() => {
  // eslint-disable-next-line no-console
  console.error('API startup failed. Check database connectivity, runtime role and configuration.');
  process.exit(1);
});
