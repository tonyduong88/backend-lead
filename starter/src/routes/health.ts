import { Router } from 'express';
import { sequelize } from '../db/sequelize';
import { asyncRoute } from './asyncRoute';

export const healthRouter = Router();

healthRouter.get('/', asyncRoute(async (_req, res) => {
  await sequelize.authenticate();
  res.json({ status: 'ok' });
}));
