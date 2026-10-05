import { config } from '../../config';
import { AppError } from '../../lib/errors';
import { mockAdapter } from './mockAdapter';
import { PspAdapter } from './types';

export function getPspAdapter(provider: string): PspAdapter {
  if (provider !== 'mock') throw new AppError(404, 'provider_not_found');
  if (!config.mockPspEnabled) throw new AppError(503, 'provider_disabled');
  return mockAdapter;
}
