import express, { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { healthRouter } from './routes/health';
import { membersRouter } from './routes/members';
import { depositsRouter } from './routes/deposits';
import { pspCallbacksRouter } from './routes/pspCallbacks';
import { wagersRouter } from './routes/wagers';
import { withdrawalsRouter } from './routes/withdrawals';
import { AppError, databaseErrorCode } from './lib/errors';
import { config } from './config';
import { observe } from './lib/metrics';
import { performance } from 'node:perf_hooks';

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.code, ...err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_error', details: err.issues });
    return;
  }
  if (err?.type === 'entity.parse.failed') { res.status(400).json({ error: 'invalid_json' }); return; }
  if (err?.type === 'entity.too.large') { res.status(413).json({ error: 'payload_too_large' }); return; }
  if (err?.status === 415) { res.status(415).json({ error: 'unsupported_encoding' }); return; }
  const code = databaseErrorCode(err);
  if (['55P03', '57014', '40P01', '40001'].includes(code ?? '') || err?.name === 'SequelizeConnectionAcquireTimeoutError') {
    res.status(503).json({ error: 'database_busy' });
    return;
  }
  // Never log Sequelize errors themselves: they may contain SQL bind values and credentials.
  console.error(JSON.stringify({ event: 'request_failed', code: code ?? 'unknown' }));
  res.status(500).json({ error: 'internal_error' });
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  let inFlight = 0;
  app.use((_req, res, next) => {
    if (inFlight >= config.maxInFlight) { res.status(503).json({ error: 'server_busy' }); return; }
    inFlight++;
    const start = performance.now();
    let released = false;
    const release = () => {
      // A disconnected client does not cancel PostgreSQL work. Keep its slot
      // until the handler settles, otherwise disconnects bypass admission control.
      if (!released && !res.locals.workInProgress) {
        released = true; inFlight--; observe('request', performance.now() - start);
      }
    };
    res.locals.releaseAdmission = release;
    res.once('finish', release);
    res.once('close', release);
    next();
  });
  app.use('/psp', pspCallbacksRouter);
  app.use(express.json({ limit: '16kb' }));

  app.use('/health', healthRouter);
  app.use('/members', membersRouter);
  app.use('/deposits', depositsRouter);
  app.use('/wallets', wagersRouter);
  app.use('/withdrawals', withdrawalsRouter);
  app.use((_req, res) => { res.status(404).json({ error: 'route_not_found' }); });

  app.use(errorHandler);
  return app;
}
