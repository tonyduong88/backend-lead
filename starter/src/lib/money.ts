import BigNumber from 'bignumber.js';
import { AppError } from './errors';

// Money invariants for this codebase:
// - Money is stored as DECIMAL(36,18) in Postgres and travels as strings in JS/JSON.
// - All arithmetic on money MUST go through BigNumber. Never use JS number math on money.
BigNumber.config({ DECIMAL_PLACES: 18, ROUNDING_MODE: BigNumber.ROUND_DOWN });

export function dec(value: string | BigNumber): BigNumber {
  if (typeof value !== 'string' && !BigNumber.isBigNumber(value)) {
    throw new AppError(400, 'invalid_money');
  }
  const bn = new BigNumber(value);
  if (!bn.isFinite()) {
    throw new AppError(400, 'invalid_money');
  }
  return bn;
}

export const ZERO = dec('0');
export const MAX_MONEY = dec('999999999999999999.999999999999999999');
const INPUT = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;

export function isPositiveMoney(value: string): boolean {
  return INPUT.test(value) && dec(value).gt(ZERO);
}

export function positiveAmount(value: string): BigNumber {
  if (typeof value !== 'string' || !isPositiveMoney(value)) {
    throw new AppError(400, 'invalid_money');
  }
  return dec(value);
}

// Never round to fit the database. Validate the result before formatting it.
export function money(value: string | BigNumber, signed = false): string {
  const n = dec(value);
  if ((!signed && n.lt(ZERO)) || n.abs().gt(MAX_MONEY) || n.decimalPlaces()! > 18) {
    throw new AppError(422, 'money_out_of_range');
  }
  return n.toFixed(18);
}

export function multiplier(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError(400, 'invalid_multiplier');
  return String(value);
}

export function requirement(amount: string, factor: string): string {
  return money(positiveAmount(amount).times(dec(factor)));
}

export function outstanding(required: string, accrued: string): string {
  const remaining = dec(required).minus(dec(accrued));
  return money(remaining.gt(ZERO) ? remaining : ZERO);
}
