import { z } from 'zod';
import { isPositiveMoney } from '../lib/money';

export const uuid = z.string().uuid();
export const amountSchema = z.string().max(37).refine(isPositiveMoney, 'Expected a positive decimal string, at most 18 integer and 18 fractional digits');
export const depositSchema = z.object({
  memberId: uuid, amount: amountSchema,
  turnoverMultiplier: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(1),
}).strict();
export const withdrawalSchema = z.object({ memberId: uuid, amount: amountSchema }).strict();
export const wagerSchema = z.object({ amount: amountSchema }).strict();
