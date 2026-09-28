import { WebSocket } from 'ws';
import type { AuthenticatedWebSocket } from './types';

/** Return whether this socket can accept new auth or subscription state. */
export function isClientLiveForAdmission(client: AuthenticatedWebSocket): boolean {
  return client.readyState === WebSocket.OPEN && !client.isQueueStopped;
}
