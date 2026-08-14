import { dispatchWebSocketAuthorizationControl } from '../websocket/authorizationControl';
import type { WebSocketAuthorizationControl } from '../websocket/authorizationControl';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('WS:AUTH_INVALIDATION');

async function dispatchBestEffort(control: WebSocketAuthorizationControl): Promise<void> {
  try {
    await dispatchWebSocketAuthorizationControl(control);
  } catch (error) {
    log.warn('WebSocket authorization invalidation failed', {
      controlType: control.type,
      error: getErrorMessage(error),
    });
  }
}

export async function invalidateWebSocketWalletAccess(
  walletIds: string | readonly string[],
): Promise<void> {
  const uniqueWalletIds = new Set(typeof walletIds === 'string' ? [walletIds] : walletIds);
  await Promise.all(
    [...uniqueWalletIds].map((walletId) => dispatchBestEffort({
      version: 1,
      type: 'wallet-access-changed',
      walletId,
    })),
  );
}

export async function disconnectWebSocketAccessToken(jti: string): Promise<void> {
  await dispatchBestEffort({ version: 1, type: 'access-token-revoked', jti });
}

export async function disconnectWebSocketUser(userId: string): Promise<void> {
  await dispatchBestEffort({ version: 1, type: 'user-access-revoked', userId });
}
