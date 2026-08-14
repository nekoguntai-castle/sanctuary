/**
 * Zero-dependency authorization invalidation contract.
 *
 * Security-sensitive services may import this module without pulling the
 * WebSocket server (and its JWT dependency graph) into their own modules.
 */
export type WebSocketAuthorizationControl =
  | { version: 1; type: 'wallet-access-changed'; walletId: string }
  | { version: 1; type: 'access-token-revoked'; jti: string }
  | { version: 1; type: 'user-access-revoked'; userId: string };

type AuthorizationControlDispatcher = (control: WebSocketAuthorizationControl) => Promise<void>;

let dispatcher: AuthorizationControlDispatcher | null = null;

export function registerWebSocketAuthorizationControlDispatcher(
  nextDispatcher: AuthorizationControlDispatcher | null,
): void {
  dispatcher = nextDispatcher;
}

export async function dispatchWebSocketAuthorizationControl(
  control: WebSocketAuthorizationControl,
): Promise<void> {
  await dispatcher?.(control);
}
