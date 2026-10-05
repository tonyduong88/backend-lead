import { Router, raw } from 'express';
import { asyncRoute } from './asyncRoute';
import { AppError } from '../lib/errors';
import { getPspAdapter } from '../integrations/psp/registry';
import { handleDepositCallback, handleDepositObservation } from '../services/fundingCallbackService';

export const pspCallbacksRouter = Router();
// Mounted before express.json(): signature-capable adapters receive the original bytes.
pspCallbacksRouter.post('/callbacks', raw({ type: 'application/json', limit: '16kb', inflate: false }),
  asyncRoute(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'expected_json');
    const adapter = getPspAdapter('mock');
    const event = await adapter.verifyAndNormalize({ rawBody: req.body, headers: req.headers });
    const result = event.kind === 'terminal'
      ? await handleDepositCallback(event) : await handleDepositObservation(event);
    const acknowledgement = adapter.acknowledgement(result);
    res.status(acknowledgement.status).json(acknowledgement.body);
  }));
