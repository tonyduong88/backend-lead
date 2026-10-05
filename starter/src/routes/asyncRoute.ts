import { RequestHandler } from 'express';

export const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  res.locals.workInProgress = true;
  Promise.resolve().then(() => handler(req, res, next)).catch(next).finally(() => {
    res.locals.workInProgress = false;
    if (res.writableFinished || res.destroyed) res.locals.releaseAdmission?.();
  });
};
