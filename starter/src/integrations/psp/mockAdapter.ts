import { z } from 'zod';
import { isPositiveMoney } from '../../lib/money';
import { AppError } from '../../lib/errors';
import { PspAdapter } from './types';

const payload = z.object({
  pspRef: z.string().min(1).max(256),
  status: z.enum(['completed', 'failed']),
  amount: z.string().max(37).refine(isPositiveMoney, 'Expected a positive decimal string'),
}).strict();

// The assignment's mock has no signature protocol. It is disabled in production.
export const mockAdapter: PspAdapter = {
  async verifyAndNormalize({ rawBody }) {
    let json: unknown;
    try { json = JSON.parse(rawBody.toString('utf8')); }
    catch { throw new AppError(400, 'invalid_json'); }
    return { kind: 'terminal', provider: 'mock', ...payload.parse(json) };
  },
  acknowledgement(result) { return { status: 200, body: result }; },
};
