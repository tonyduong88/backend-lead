import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockAdapter } from '../../src/integrations/psp/mockAdapter';
import { getPspAdapter } from '../../src/integrations/psp/registry';
import { config } from '../../src/config';

describe('offline mock PSP contract', () => {
  it.each(['completed', 'failed'])('normalizes the %s raw fixture without numeric coercion', async status => {
    const rawBody = readFileSync(join(__dirname, 'fixtures', status + '.json'));
    const event = await mockAdapter.verifyAndNormalize({ rawBody, headers: {} });
    expect(event).toMatchObject({ kind: 'terminal', provider: 'mock', status, pspRef: 'fixture-reference' });
    expect(event.amount).toBe(status === 'completed' ? '0.100000000000000001' : '100.50');
  });

  it.each([
    { status: 'pending', amount: '1' }, { status: 'SUCCESS', amount: '1' },
    { status: 'completed', amount: 1 }, { status: 'completed', amount: '1e2' },
    { status: 'completed', amount: 'NaN' }, { status: 'completed' },
    { status: 'completed', amount: '1', provider: 'attacker' },
  ])('rejects malformed or unsupported provider data %p', async fields => {
    await expect(mockAdapter.verifyAndNormalize({ rawBody: Buffer.from(JSON.stringify({ pspRef: 'test', ...fields })), headers: {} })).rejects.toBeDefined();
  });

  it('selects only configured providers and honors the kill switch', () => {
    expect(() => getPspAdapter('unknown')).toThrow('provider_not_found');
    const enabled = config.mockPspEnabled; config.mockPspEnabled = false;
    try { expect(() => getPspAdapter('mock')).toThrow('provider_disabled'); }
    finally { config.mockPspEnabled = enabled; }
  });
});
