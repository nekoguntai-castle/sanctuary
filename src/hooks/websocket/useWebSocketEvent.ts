/**
 * WebSocket Event Hook
 *
 * Subscribe to specific WebSocket event types.
 */

import { useEffect } from 'react';
import { websocketClient, WebSocketEvent, WebSocketEventType } from '../../services/websocket';

export const useWebSocketEvent = (
  eventType: WebSocketEventType | '*',
  callback: (event: WebSocketEvent) => void,
  deps: unknown[] = []
) => {
  useEffect(() => {
    websocketClient.on(eventType, callback);

    return () => {
      websocketClient.off(eventType, callback);
    };
  }, [eventType, ...deps]);
};
