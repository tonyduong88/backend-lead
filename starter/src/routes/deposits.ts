import { Router } from 'express';
import { asyncRoute } from './asyncRoute';
import { depositSchema } from './schemas';
import { createDeposit } from '../services/depositService';
import { getPspAdapter } from '../integrations/psp/registry';

export const depositsRouter = Router();
depositsRouter.post('/', asyncRoute(async (req, res) => {
  const input = depositSchema.parse(req.body);
  getPspAdapter('mock');
  res.status(201).json(await createDeposit(input));
}));
