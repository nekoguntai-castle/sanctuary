/**
 * Shared harness for WebSocket hook tests.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Store connection change callbacks for testing
const connectionChangeCallbacks: Set<(connected: boolean) => void> = new Set();
const eventCallbacks: Map<string, Set<(event: any) => void>> = new Map();

const {
  mockConnect,
  mockDisconnect,
  mockSubscribe,
  mockUnsubscribe,
  mockSubscribeBatch,
  mockUnsubscribeBatch,
  mockOn,
  mockOff,
  mockIsConnected,
  mockGetState,
  mockOnConnectionChange,
  mockOffConnectionChange,
  mockGetWalletLogs,
  mockInvalidateQueries,
  mockSetQueryData,
  mockQueryClient,
} = vi.hoisted(() => {
  const mockInvalidateQueries = vi.fn();
  const mockSetQueryData = vi.fn();
  const mockQueryClient = {
    invalidateQueries: (...args: any[]) => mockInvalidateQueries(...args),
    setQueryData: (...args: any[]) => mockSetQueryData(...args),
  };

  return {
    mockConnect: vi.fn(),
    mockDisconnect: vi.fn(),
    mockSubscribe: vi.fn(),
    mockUnsubscribe: vi.fn(),
    mockSubscribeBatch: vi.fn(),
    mockUnsubscribeBatch: vi.fn(),
    mockOn: vi.fn(),
    mockOff: vi.fn(),
    mockIsConnected: vi.fn(),
    mockGetState: vi.fn(),
    mockOnConnectionChange: vi.fn(),
    mockOffConnectionChange: vi.fn(),
    mockGetWalletLogs: vi.fn(),
    mockInvalidateQueries,
    mockSetQueryData,
    mockQueryClient,
  };
});

vi.mock('../../../services/websocket', () => ({
  websocketClient: {
    connect: (...args: any[]) => mockConnect(...args),
    disconnect: (...args: any[]) => mockDisconnect(...args),
    subscribe: (...args: any[]) => mockSubscribe(...args),
    unsubscribe: (...args: any[]) => mockUnsubscribe(...args),
    subscribeBatch: (...args: any[]) => mockSubscribeBatch(...args),
    unsubscribeBatch: (...args: any[]) => mockUnsubscribeBatch(...args),
    on: (...args: any[]) => mockOn(...args),
    off: (...args: any[]) => mockOff(...args),
    isConnected: (...args: any[]) => mockIsConnected(...args),
    getState: (...args: any[]) => mockGetState(...args),
    onConnectionChange: (...args: any[]) => mockOnConnectionChange(...args),
    offConnectionChange: (...args: any[]) => mockOffConnectionChange(...args),
  },
  WebSocketEvent: {},
  WebSocketEventType: {},
}));

// Phase 4: useWebSocket no longer reads a token from apiClient; the
// browser's sanctuary_access HttpOnly cookie is attached automatically
// by the same-origin WebSocket upgrade, and the server's extractToken
// in websocket/auth.ts reads it from the upgrade request.

vi.mock('../../../src/api/sync', () => ({
  getWalletLogs: (...args: any[]) => mockGetWalletLogs(...args),
}));

vi.mock('../../../providers/QueryProvider', () => ({
  queryClient: mockQueryClient,
  getQueryClient: () => mockQueryClient,
}));

// Helper to flush pending promises for React state updates.
const flushPromises = () => new Promise<void>(resolve => queueMicrotask(resolve));

// Import hooks after mocks.
import { useModelDownloadProgress } from '../../../hooks/websocket/useModelDownloadProgress';
import { useWalletEvents } from '../../../hooks/websocket/useWalletEvents';
import { useWalletLogs } from '../../../hooks/websocket/useWalletLogs';
import { useWebSocket } from '../../../hooks/websocket/useWebSocket';
import { useWebSocketEvent } from '../../../hooks/websocket/useWebSocketEvent';
import { useWebSocketQueryInvalidation } from '../../../hooks/websocket/useWebSocketQueryInvalidation';

export {
  act,
  afterEach,
  beforeEach,
  connectionChangeCallbacks,
  describe,
  eventCallbacks,
  expect,
  flushPromises,
  it,
  mockConnect,
  mockDisconnect,
  mockGetState,
  mockGetWalletLogs,
  mockInvalidateQueries,
  mockIsConnected,
  mockOff,
  mockOffConnectionChange,
  mockOn,
  mockOnConnectionChange,
  mockQueryClient,
  mockSetQueryData,
  mockSubscribe,
  mockSubscribeBatch,
  mockUnsubscribe,
  mockUnsubscribeBatch,
  renderHook,
  useModelDownloadProgress,
  useWalletEvents,
  useWalletLogs,
  useWebSocket,
  useWebSocketEvent,
  useWebSocketQueryInvalidation,
  vi,
  waitFor,
};
