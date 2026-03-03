import { createHash, createHmac } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config', () => ({
  config: {
    gatewaySecret: 'test-gateway-secret',
  },
}));

import { generateRequestSignature } from '../../../src/services/backendEvents/auth';

describe('backendEvents auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates signature with uppercase method and body hash for non-empty payloads', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const body = { walletId: 'wallet-1', eventType: 'transaction' };

    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const expectedMessage = `POST/api/v1/events1700000000000${bodyHash}`;
    const expectedSignature = createHmac('sha256', 'test-gateway-secret')
      .update(expectedMessage)
      .digest('hex');

    const result = generateRequestSignature('post', '/api/v1/events', body);

    expect(result.timestamp).toBe('1700000000000');
    expect(result.signature).toBe(expectedSignature);
  });

  it('omits body hash for empty payload objects', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000001);

    const expectedMessage = 'GET/api/v1/ping1700000000001';
    const expectedSignature = createHmac('sha256', 'test-gateway-secret')
      .update(expectedMessage)
      .digest('hex');

    const result = generateRequestSignature('GET', '/api/v1/ping', {});

    expect(result.timestamp).toBe('1700000000001');
    expect(result.signature).toBe(expectedSignature);
  });

  it('omits body hash for null payloads', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000002);

    const expectedMessage = 'DELETE/api/v1/push/device1700000000002';
    const expectedSignature = createHmac('sha256', 'test-gateway-secret')
      .update(expectedMessage)
      .digest('hex');

    const result = generateRequestSignature('delete', '/api/v1/push/device', null);

    expect(result.timestamp).toBe('1700000000002');
    expect(result.signature).toBe(expectedSignature);
  });
});
