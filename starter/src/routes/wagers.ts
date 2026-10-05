import { Router } from 'express';
import { asyncRoute } from './asyncRoute';
import { uuid, wagerSchema } from './schemas';
import { recordWager } from '../services/wagerService';

export const wagersRouter = Router();
wagersRouter.post('/:walletId/wagers', asyncRoute(async (req, res) => {
  const walletId = uuid.parse(req.params.walletId);
  const body = wagerSchema.parse(req.body);
  res.status(201).json(await recordWager(walletId, body.amount));
}));
