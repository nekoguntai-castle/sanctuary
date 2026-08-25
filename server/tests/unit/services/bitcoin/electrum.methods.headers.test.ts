import { describe, expect, it, vi } from 'vitest';
import { getBlockHeaders } from '../../../../src/services/bitcoin/electrum/methods';
import { ELECTRUM_MAX_HEADERS_PER_REQUEST } from '../../../../src/services/bitcoin/electrum/types';

const HEADER_A = '00'.repeat(80);
const HEADER_B = 'ab'.repeat(80);

describe('electrum methods getBlockHeaders', () => {
  it('returns individually validated headers from a valid multi-header response', async () => {
    const request = vi.fn().mockResolvedValue({
      count: 2,
      hex: HEADER_A + HEADER_B,
      max: ELECTRUM_MAX_HEADERS_PER_REQUEST,
    });

    await expect(getBlockHeaders(request, 100, 2)).resolves.toEqual([HEADER_A, HEADER_B]);
    expect(request).toHaveBeenCalledWith('blockchain.block.headers', [100, 2]);
  });

  it.each([
    ['negative start height', -1, 1],
    ['fractional start height', 1.5, 1],
    ['unsafe start height', Number.MAX_SAFE_INTEGER + 1, 1],
    ['zero count', 0, 0],
    ['negative count', 0, -1],
    ['fractional count', 0, 1.5],
    ['oversized count', 0, ELECTRUM_MAX_HEADERS_PER_REQUEST + 1],
  ])('rejects an invalid %s before sending a request', async (_label, startHeight, count) => {
    const request = vi.fn();

    await expect(getBlockHeaders(request, startHeight, count)).rejects.toThrow('Invalid Electrum');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a partial response for an exact range', async () => {
    const request = vi.fn().mockResolvedValue({ count: 1, hex: HEADER_A });

    await expect(getBlockHeaders(request, 100, 2)).rejects.toThrow(
      'expected 2 headers, received 1',
    );
  });

  it('rejects a response count above the protocol maximum', async () => {
    const request = vi.fn().mockResolvedValue({
      count: ELECTRUM_MAX_HEADERS_PER_REQUEST + 1,
      hex: '',
    });

    await expect(getBlockHeaders(request, 0, 1)).rejects.toThrow('Invalid Electrum response');
  });

  it.each([
    ['non-object response', 'not-an-object'],
    ['unknown response property', { count: 1, hex: HEADER_A, extra: true }],
    ['malformed hex', { count: 1, hex: 'zz'.repeat(80) }],
    ['oversized hex', { count: 1, hex: '00'.repeat((ELECTRUM_MAX_HEADERS_PER_REQUEST * 80) + 1) }],
    ['zero response count', { count: 0, hex: '' }],
    ['invalid advertised maximum', { count: 1, hex: HEADER_A, max: ELECTRUM_MAX_HEADERS_PER_REQUEST + 1 }],
  ])('rejects %s', async (_label, response) => {
    const request = vi.fn().mockResolvedValue(response);

    await expect(getBlockHeaders(request, 0, 1)).rejects.toThrow('Invalid Electrum response');
  });

  it('rejects a count and hex-length mismatch', async () => {
    const request = vi.fn().mockResolvedValue({ count: 2, hex: HEADER_A });

    await expect(getBlockHeaders(request, 0, 2)).rejects.toThrow(
      'expected 320 hex characters, received 160',
    );
  });

  it('accepts the protocol maximum count', async () => {
    const hex = HEADER_A.repeat(ELECTRUM_MAX_HEADERS_PER_REQUEST);
    const request = vi.fn().mockResolvedValue({
      count: ELECTRUM_MAX_HEADERS_PER_REQUEST,
      hex,
    });

    const headers = await getBlockHeaders(
      request,
      Number.MAX_SAFE_INTEGER,
      ELECTRUM_MAX_HEADERS_PER_REQUEST,
    );

    expect(headers).toHaveLength(ELECTRUM_MAX_HEADERS_PER_REQUEST);
    expect(headers[0]).toBe(HEADER_A);
    expect(headers.at(-1)).toBe(HEADER_A);
  });
});
