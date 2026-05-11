import { createHash, createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  createGatewaySignature,
  generateGatewaySignature,
  hashGatewayBody,
} from '@sanctuary/shared/utils/gatewayAuth';

describe('shared gateway auth utilities', () => {
  it('treats null, undefined, and empty plain objects as an empty body', () => {
    expect(hashGatewayBody(null)).toBe('');
    expect(hashGatewayBody(undefined)).toBe('');
    expect(hashGatewayBody({})).toBe('');
    expect(hashGatewayBody(Object.create(null))).toBe('');
  });

  it('hashes arrays, buffers, and non-empty objects distinctly', () => {
    expect(hashGatewayBody([])).toBe(createHash('sha256').update('[]').digest('hex'));
    expect(hashGatewayBody({ a: 1 })).toBe(createHash('sha256').update('{"a":1}').digest('hex'));
    expect(hashGatewayBody(Buffer.from('abc'))).toBe(
      createHash('sha256').update(JSON.stringify(Buffer.from('abc'))).digest('hex')
    );
  });

  it('creates the expected method/path/timestamp/bodyHash HMAC', () => {
    const bodyHash = hashGatewayBody({ walletId: 'wallet-1' });
    const expected = createHmac('sha256', 'secret')
      .update(`POST/internal/mobile-permissions/check1700000000000${bodyHash}`)
      .digest('hex');

    expect(createGatewaySignature(
      'post',
      '/internal/mobile-permissions/check',
      '1700000000000',
      bodyHash,
      'secret'
    )).toBe(expected);
  });

  it('generates a deterministic signature when timestamp is supplied', () => {
    const body = { userId: 'user-1' };
    const result = generateGatewaySignature(
      'GET',
      '/api/v1/push/by-user/user-1',
      body,
      'secret',
      '1700000000001'
    );
    const expectedBodyHash = hashGatewayBody(body);

    expect(result).toEqual({
      timestamp: '1700000000001',
      signature: createGatewaySignature(
        'GET',
        '/api/v1/push/by-user/user-1',
        '1700000000001',
        expectedBodyHash,
        'secret'
      ),
    });
  });
});
