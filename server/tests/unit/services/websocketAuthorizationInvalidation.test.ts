import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatch, mockWarn } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../../../src/websocket/authorizationControl', () => ({
  dispatchWebSocketAuthorizationControl: (...args: unknown[]) => mockDispatch(...args),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

import {
  disconnectWebSocketAccessToken,
  disconnectWebSocketUser,
  invalidateWebSocketWalletAccess,
} from '../../../src/services/websocketAuthorizationInvalidation';

describe('websocketAuthorizationInvalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatch.mockResolvedValue(undefined);
  });

  it('dispatches wallet, token, and user controls', async () => {
    await invalidateWebSocketWalletAccess(['wallet-1', 'wallet-1', 'wallet-2']);
    await disconnectWebSocketAccessToken('jti-1');
    await disconnectWebSocketUser('user-1');

    expect(mockDispatch.mock.calls).toEqual([
      [{ version: 1, type: 'wallet-access-changed', walletId: 'wallet-1' }],
      [{ version: 1, type: 'wallet-access-changed', walletId: 'wallet-2' }],
      [{ version: 1, type: 'access-token-revoked', jti: 'jti-1' }],
      [{ version: 1, type: 'user-access-revoked', userId: 'user-1' }],
    ]);
  });

  it('does not turn a post-commit eager invalidation failure into mutation failure', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(invalidateWebSocketWalletAccess('wallet-1')).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledWith(
      'WebSocket authorization invalidation failed',
      expect.objectContaining({ controlType: 'wallet-access-changed' }),
    );
  });
});
