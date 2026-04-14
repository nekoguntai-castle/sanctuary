import { describe, expect, it } from 'vitest';
import {
  manager,
  mockClient,
} from './electrumManagerTestHarness';

export function registerElectrumManagerIsConnectedContracts() {
  describe('isConnected', () => {
    it('should return false when no networks are connected', () => {
      expect(manager.isConnected()).toBe(false);
    });

    it('should return false when all tracked networks are disconnected', () => {
      (manager as any).networks.set('mainnet', {
        network: 'mainnet',
        client: mockClient,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });

      expect(manager.isConnected()).toBe(false);
    });
  });
}
