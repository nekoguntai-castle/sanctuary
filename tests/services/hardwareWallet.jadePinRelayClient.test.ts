import { describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());

vi.mock('../../src/api/client', () => ({ default: { post } }));

import { relayJadePinRequest } from '../../src/services/hardwareWallet/adapters/jadePinRelayClient';

describe('Jade PIN relay client', () => {
  it('uses one bounded same-origin POST and validates the JSON result', async () => {
    post.mockResolvedValueOnce({ pin: 'opaque' });
    const request = { operation: 'get_pin' as const, data: { blinded: true } };

    await expect(relayJadePinRequest(request)).resolves.toEqual({ pin: 'opaque' });
    expect(post).toHaveBeenCalledWith('/hardware/jade/pin', request, {
      timeoutMs: 15_000,
      schema: expect.objectContaining({ safeParse: expect.any(Function) }),
    });
  });

  it('propagates relay failures without substituting a response', async () => {
    const failure = new Error('Jade PIN relay unavailable');
    post.mockRejectedValueOnce(failure);

    await expect(relayJadePinRequest({ operation: 'set_pin', data: null }))
      .rejects.toBe(failure);
  });
});
