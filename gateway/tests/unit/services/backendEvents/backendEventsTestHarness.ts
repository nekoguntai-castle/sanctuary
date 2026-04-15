import { EventEmitter } from 'events';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

type BackendEventsWebSocket = EventEmitter & {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  simulateMessage(data: object): void;
  simulateOpen(): void;
  simulateClose(code?: number, reason?: string): void;
  simulateError(error: Error): void;
};

type DeviceResponse = {
  id: string;
  platform: string;
  pushToken: string;
  userId: string;
};

const backendEventsMocks = vi.hoisted(() => {
  const wsInstances: any[] = [];
  const wsConstructorSpy = vi.fn();
  const mockFetch = vi.fn();

  return { wsInstances, wsConstructorSpy, mockFetch };
});

vi.mock('ws', () => {
  return {
    default: class WebSocket extends EventEmitter {
      static instances = backendEventsMocks.wsInstances;
      readyState = 1;
      send = vi.fn();
      close = vi.fn();

      constructor(url?: string) {
        super();
        backendEventsMocks.wsConstructorSpy(url);
        backendEventsMocks.wsInstances.push(this);
      }

      simulateMessage(data: object): void {
        this.emit('message', JSON.stringify(data));
      }

      simulateOpen(): void {
        this.emit('open');
      }

      simulateClose(code = 1000, reason = ''): void {
        this.emit('close', code, Buffer.from(reason));
      }

      simulateError(error: Error): void {
        this.emit('error', error);
      }
    },
  };
});

vi.mock('../../../../src/config', () => ({
  config: {
    gatewaySecret: 'test-gateway-secret',
    backendUrl: 'http://localhost:3000',
    backendWsUrl: 'ws://localhost:3000',
    backendRequestTimeoutMs: 5000,
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../src/services/push', () => ({
  formatTransactionNotification: vi.fn((type, walletName, amount, txid) => ({
    title: `Bitcoin ${type === 'received' ? 'Received' : type === 'sent' ? 'Sent' : 'Confirmed'}`,
    body: `${walletName}: ${amount} sats`,
    data: { type: type === 'confirmed' ? 'confirmation' : 'transaction', txid },
  })),
  formatBroadcastNotification: vi.fn((success, walletName, txid, error) => ({
    title: success ? 'Transaction Broadcast' : 'Broadcast Failed',
    body: success ? `Transaction sent from ${walletName}` : `Failed: ${error || 'Unknown'}`,
    data: { type: success ? 'broadcast_success' : 'broadcast_failed', txid },
  })),
  formatPsbtSigningNotification: vi.fn((walletName, draftId, creatorName, amount, required, current) => ({
    title: 'Signature Required',
    body: `${creatorName} needs your signature on ${walletName}`,
    data: { type: 'psbt_signing_required', draftId },
  })),
  formatDraftCreatedNotification: vi.fn((walletName, draftId, creatorName, amount) => ({
    title: 'New Draft Transaction',
    body: `${creatorName} created a draft on ${walletName}`,
    data: { type: 'draft_created', draftId },
  })),
  formatDraftApprovedNotification: vi.fn((walletName, draftId, signerName, current, required) => ({
    title: current >= required ? 'Transaction Ready' : 'Draft Signed',
    body: `${signerName} signed the draft on ${walletName}`,
    data: { type: 'draft_approved', draftId },
  })),
  sendToDevices: vi.fn().mockResolvedValue({
    success: 1,
    failed: 0,
    invalidTokens: [],
  }),
}));

let backendEventsService: typeof import('../../../../src/services/backendEvents');
export let push: typeof import('../../../../src/services/push');

export const wsConstructorSpy = backendEventsMocks.wsConstructorSpy;
export const wsInstances = backendEventsMocks.wsInstances as BackendEventsWebSocket[];
export const mockFetch = backendEventsMocks.mockFetch;

export function setupBackendEventsTestHarness(): void {
  beforeAll(async () => {
    backendEventsService = await import('../../../../src/services/backendEvents');
    push = await import('../../../../src/services/push');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    backendEventsMocks.wsInstances.length = 0;
    backendEventsMocks.mockFetch.mockReset();
    global.fetch = backendEventsMocks.mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    stopBackendEvents();
    vi.useRealTimers();
  });
}

function getBackendEventsService(): typeof import('../../../../src/services/backendEvents') {
  if (!backendEventsService) {
    throw new Error('backendEvents service was not loaded before the test ran');
  }

  return backendEventsService;
}

export function startBackendEvents(): void {
  getBackendEventsService().startBackendEvents();
}

export function stopBackendEvents(): void {
  getBackendEventsService().stopBackendEvents();
}

export function mockDeviceFetchResponse(devices: DeviceResponse[] = [
  {
    id: 'device-1',
    platform: 'android',
    pushToken: 'fcm-token',
    userId: 'user-123',
  },
]): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(devices),
  });
}
