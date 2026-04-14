import { afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const {
  netConnectMock,
  tlsConnectMock,
  socksCreateConnectionMock,
  nodeConfigFindFirstMock,
} = vi.hoisted(() => ({
  netConnectMock: vi.fn(),
  tlsConnectMock: vi.fn(),
  socksCreateConnectionMock: vi.fn(),
  nodeConfigFindFirstMock: vi.fn(),
}));

vi.mock('net', () => ({
  default: { connect: netConnectMock },
  connect: netConnectMock,
}));

vi.mock('tls', () => ({
  default: { connect: tlsConnectMock },
  connect: tlsConnectMock,
}));

vi.mock('socks', () => ({
  SocksClient: {
    createConnection: socksCreateConnectionMock,
  },
}));

vi.mock('../../../../../src/config', () => ({
  __esModule: true,
  default: {
    bitcoin: {
      electrum: {
        host: 'fallback-host',
        port: 50001,
        protocol: 'tcp',
      },
    },
  },
  getConfig: () => ({
    electrumClient: {
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 60,
      connectionTimeoutMs: 30,
      torTimeoutMultiplier: 3,
    },
  }),
}));

vi.mock('../../../../../src/repositories', () => ({
  nodeConfigRepository: {
    findDefault: nodeConfigFindFirstMock,
    findDefaultWithServers: nodeConfigFindFirstMock,
    electrumServer: {
      updateHealth: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

type ElectrumClientConstructor = typeof import('../../../../../src/services/bitcoin/electrum')['ElectrumClient'];

export let ElectrumClient: ElectrumClientConstructor;

export class FakeSocket extends EventEmitter {
  write = vi.fn();
  destroy = vi.fn();
  setNoDelay = vi.fn();
  setKeepAlive = vi.fn();
}

export { netConnectMock, tlsConnectMock, socksCreateConnectionMock, nodeConfigFindFirstMock };

export function setupElectrumConnectionTestHooks(): void {
  beforeAll(async () => {
    const electrum = await import('../../../../../src/services/bitcoin/electrum');
    ElectrumClient = electrum.ElectrumClient;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    nodeConfigFindFirstMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
