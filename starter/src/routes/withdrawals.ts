import { Router } from 'express';
import { asyncRoute } from './asyncRoute';
import { withdrawalSchema } from './schemas';
import { createWithdrawal } from '../services/withdrawalService';

export const withdrawalsRouter = Router();
withdrawalsRouter.post('/', asyncRoute(async (req, res) => {
  res.status(201).json(await createWithdrawal(withdrawalSchema.parse(req.body)));
}));
