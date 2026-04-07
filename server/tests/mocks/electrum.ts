import { vi, Mock } from 'vitest';
/**
 * Electrum Client Mock
 *
 * Mocks the Electrum/node client for testing blockchain interactions.
 */

export interface MockElectrumTransaction {
  txid: string;
  hex: string;
  blockheight?: number;
  confirmations?: number;
  time?: number;
  vin: Array<{
    txid?: string;
    vout?: number;
    coinbase?: boolean;
    prevout?: {
      value: number;
      scriptPubKey: {
        hex: string;
        address?: string;
        addresses?: string[];
      };
    };
  }>;
  vout: Array<{
    value: number;
    n: number;
    scriptPubKey: {
      hex: string;
      address?: string;
      addresses?: string[];
    };
  }>;
}

export interface MockUTXO {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
}

export interface MockAddressHistory {
  tx_hash: string;
  height: number;
}

// Create the mock Electrum client
export const mockElectrumClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  isConnected: vi.fn().mockReturnValue(true),

  // Server info
  getServerVersion: vi.fn().mockResolvedValue({ server: 'ElectrumX', protocol: '1.4' }),

  // Transaction methods
  getTransaction: vi.fn().mockResolvedValue(null),
  getTransactionsBatch: vi.fn().mockResolvedValue(new Map()),
  broadcastTransaction: vi.fn().mockResolvedValue('mock-txid'),

  // Address methods
  getAddressHistory: vi.fn().mockResolvedValue([]),
  getAddressHistoryBatch: vi.fn().mockResolvedValue(new Map()),
  getAddressBalance: vi.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
  getAddressUTXOs: vi.fn().mockResolvedValue([]),
  getAddressUTXOsBatch: vi.fn().mockResolvedValue(new Map()),
  subscribeAddress: vi.fn().mockResolvedValue('subscription-id'),
  subscribeAddressBatch: vi.fn().mockResolvedValue(new Map()),

  // Block methods
  getBlockHeight: vi.fn().mockResolvedValue(800000),
  getBlockHeader: vi.fn().mockResolvedValue({ hash: 'abc123', height: 800000, timestamp: 1700000000 }),

  // Fee estimation
  estimateFee: vi.fn().mockResolvedValue(10),
};

// Helper to create mock transaction
export function createMockTransaction(options: {
  txid?: string;
  hex?: string;
  blockheight?: number;
  confirmations?: number;
  inputs?: Array<{
    txid: string;
    vout: number;
    value: number;
    address: string;
  }>;
  outputs?: Array<{
    value: number;
    address: string;
  }>;
  /** Set to true to create a coinbase transaction (mining reward) */
  coinbase?: boolean;
}): MockElectrumTransaction {
  const txid = options.txid || 'a'.repeat(64);

  // Coinbase transactions have a special input structure
  const vin = options.coinbase
    ? [{ coinbase: true }] // Coinbase input has no txid/vout
    : (options.inputs || []).map((input) => ({
        txid: input.txid,
        vout: input.vout,
        prevout: {
          value: input.value,
          scriptPubKey: {
            hex: '0014' + 'a'.repeat(40),
            address: input.address,
          },
        },
      }));

  return {
    txid,
    hex: options.hex || '0200000001' + '0'.repeat(200),
    blockheight: options.blockheight,
    confirmations: options.confirmations || 0,
    time: options.blockheight ? Date.now() / 1000 - (800000 - options.blockheight) * 600 : undefined,
    vin,
    vout: (options.outputs || []).map((output, index) => ({
      value: output.value,
      n: index,
      scriptPubKey: {
        hex: '0014' + 'b'.repeat(40),
        address: output.address,
      },
    })),
  };
}

// Helper to create mock UTXO
export function createMockUTXO(options: {
  txid?: string;
  vout?: number;
  value: number;
  height?: number;
}): MockUTXO {
  return {
    tx_hash: options.txid || 'c'.repeat(64),
    tx_pos: options.vout ?? 0,
    value: options.value,
    height: options.height ?? 799999,
  };
}

// Helper to create mock address history
export function createMockAddressHistory(options: {
  txid?: string;
  height?: number;
}[]): MockAddressHistory[] {
  return options.map((opt) => ({
    tx_hash: opt.txid || 'd'.repeat(64),
    height: opt.height ?? 799999,
  }));
}

// Reset all Electrum mocks
export function resetElectrumMocks(): void {
  Object.values(mockElectrumClient).forEach((method) => {
    if (typeof method === 'function' && 'mockClear' in method) {
      (method as Mock).mockClear();
    }
  });
}

// Setup common mock returns
export function setupElectrumMockReturns(config: {
  blockHeight?: number;
  feeRate?: number;
  transactions?: Map<string, MockElectrumTransaction>;
  utxos?: Map<string, MockUTXO[]>;
  history?: Map<string, MockAddressHistory[]>;
}): void {
  if (config.blockHeight !== undefined) {
    mockElectrumClient.getBlockHeight.mockResolvedValue(config.blockHeight);
  }
  if (config.feeRate !== undefined) {
    mockElectrumClient.estimateFee.mockResolvedValue(config.feeRate);
  }
  if (config.transactions) {
    mockElectrumClient.getTransaction.mockImplementation((txid: string) => {
      return Promise.resolve(config.transactions?.get(txid) || null);
    });
  }
  if (config.utxos) {
    mockElectrumClient.getAddressUTXOs.mockImplementation((address: string) => {
      return Promise.resolve(config.utxos?.get(address) || []);
    });
  }
  if (config.history) {
    mockElectrumClient.getAddressHistory.mockImplementation((address: string) => {
      return Promise.resolve(config.history?.get(address) || []);
    });
  }
}

// Mock Electrum Pool
export const mockElectrumPool = {
  initialize: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
  acquire: vi.fn().mockImplementation(() =>
    Promise.resolve({
      client: mockElectrumClient,
      release: vi.fn(),
      withClient: vi.fn().mockImplementation((fn: (client: typeof mockElectrumClient) => Promise<unknown>) =>
        fn(mockElectrumClient)
      ),
    })
  ),
  getSubscriptionConnection: vi.fn().mockResolvedValue(mockElectrumClient),
  getPoolStats: vi.fn().mockReturnValue({
    totalConnections: 2,
    activeConnections: 1,
    idleConnections: 1,
    waitingRequests: 0,
    totalAcquisitions: 100,
    averageAcquisitionTimeMs: 5,
    healthCheckFailures: 0,
    serverCount: 1,
    servers: [
      {
        serverId: 'server-1',
        label: 'Test Server',
        host: 'electrum.example.com',
        port: 50002,
        connectionCount: 2,
        healthyConnections: 2,
        totalRequests: 100,
        failedRequests: 0,
        isHealthy: true,
        lastHealthCheck: new Date().toISOString(),
      },
    ],
  }),
  isPoolInitialized: vi.fn().mockReturnValue(true),
  isHealthy: vi.fn().mockReturnValue(true),
  getEffectiveMinConnections: vi.fn().mockReturnValue(1),
  getEffectiveMaxConnections: vi.fn().mockReturnValue(5),
  setServers: vi.fn(),
  getServers: vi.fn().mockReturnValue([]),
  reloadServers: vi.fn().mockResolvedValue(undefined),
};

// Reset all Electrum Pool mocks
export function resetElectrumPoolMocks(): void {
  Object.values(mockElectrumPool).forEach((method) => {
    if (typeof method === 'function' && 'mockClear' in method) {
      (method as Mock).mockClear();
    }
  });
}

export default mockElectrumClient;
