/**
 * useWebSocket Hook Tests
 *
 * Tests for WebSocket hooks that manage real-time connections and subscriptions.
 * Covers connection lifecycle, authentication, subscription management, and event handling.
 */

import { registerUseModelDownloadProgressTests } from './websocket/use-model-download-progress.contracts';
import { registerUseWalletEventsTests } from './websocket/use-wallet-events.contracts';
import { registerUseWalletLogsTests } from './websocket/use-wallet-logs.contracts';
import { registerUseWebSocketEventTests } from './websocket/use-websocket-event.contracts';
import { registerUseWebSocketQueryInvalidationTests } from './websocket/use-websocket-query-invalidation.contracts';
import { registerUseWebSocketTests } from './websocket/use-websocket.contracts';

registerUseWebSocketTests();
registerUseWebSocketEventTests();
registerUseWalletEventsTests();
registerUseWalletLogsTests();
registerUseModelDownloadProgressTests();
registerUseWebSocketQueryInvalidationTests();
