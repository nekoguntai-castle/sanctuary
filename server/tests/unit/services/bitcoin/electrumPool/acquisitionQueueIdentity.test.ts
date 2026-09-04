import { describe, expect, it, vi } from 'vitest';
import {
  activateConnection,
  activateConnectionSingleMode,
} from '../../../../../src/services/bitcoin/electrumPool/acquisitionQueue';
import type { PooledConnection } from '../../../../../src/services/bitcoin/electrumPool/types';

function makeConnection(overrides: Partial<PooledConnection> = {}): PooledConnection {
  return {
    id: 'conn-1',
    client: {} as PooledConnection['client'],
    state: 'idle',
    createdAt: new Date(),
    lastUsedAt: new Date(),
    lastHealthCheck: new Date(),
    useCount: 0,
    isDedicated: false,
    serverId: 'server-1',
    serverLabel: 'Primary Server',
    serverHost: 'primary.example.com',
    serverPort: 50002,
    ...overrides,
  };
}

describe('acquisitionQueue handle identity (A3)', () => {
  it('activateConnection populates serverId/serverLabel/serverHost/serverPort from the borrowed PooledConnection', () => {
    const conn = makeConnection({
      serverId: 'backup-1',
      serverLabel: 'Backup Server',
      serverHost: 'backup.example.com',
      serverPort: 60002,
    });
    const stats = { totalAcquisitions: 0, totalAcquisitionTimeMs: 0 };

    const handle = activateConnection(conn, 'status', Date.now(), 'mainnet', stats, vi.fn());

    expect(handle.serverId).toBe('backup-1');
    expect(handle.serverLabel).toBe('Backup Server');
    expect(handle.serverHost).toBe('backup.example.com');
    expect(handle.serverPort).toBe(60002);
    expect(handle.client).toBe(conn.client);
  });

  it('activateConnectionSingleMode populates the same identity fields from the borrowed PooledConnection', () => {
    const conn = makeConnection({
      serverId: 'singleton-server',
      serverLabel: 'Singleton',
      serverHost: 'singleton.example.com',
      serverPort: 50001,
    });
    const stats = { totalAcquisitions: 0, totalAcquisitionTimeMs: 0 };

    const handle = activateConnectionSingleMode(conn, Date.now(), 'mainnet', stats);

    expect(handle.serverId).toBe('singleton-server');
    expect(handle.serverLabel).toBe('Singleton');
    expect(handle.serverHost).toBe('singleton.example.com');
    expect(handle.serverPort).toBe(50001);
    expect(handle.client).toBe(conn.client);
  });

  it('identity fields are immutable snapshots: mutating the connection afterward does not change an already-issued handle', () => {
    const conn = makeConnection({ serverId: 'server-a', serverLabel: 'A', serverHost: 'a.example.com', serverPort: 1 });
    const stats = { totalAcquisitions: 0, totalAcquisitionTimeMs: 0 };

    const handle = activateConnection(conn, undefined, Date.now(), 'mainnet', stats, vi.fn());
    conn.serverId = 'server-b';
    conn.serverLabel = 'B';
    conn.serverHost = 'b.example.com';
    conn.serverPort = 2;

    expect(handle.serverId).toBe('server-a');
    expect(handle.serverLabel).toBe('A');
    expect(handle.serverHost).toBe('a.example.com');
    expect(handle.serverPort).toBe(1);
  });
});
