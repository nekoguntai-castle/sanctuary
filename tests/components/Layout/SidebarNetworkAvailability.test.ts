import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSidebarNetworkAvailability } from '../../../components/Layout/useLayoutController';
import * as bitcoinApi from '../../../src/api/bitcoin';

vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

describe('sidebar network availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks Testnet3 and Signet unavailable only when status reports Node Configuration disabled copy', async () => {
    vi.mocked(bitcoinApi.getStatus).mockImplementation(async (network) => ({
      connected: false,
      error: network === 'testnet3'
        ? 'Testnet sync is off in Node Configuration. Enable Testnet under Network Connections.'
        : 'Connection refused',
    }) as any);

    await expect(getSidebarNetworkAvailability()).resolves.toEqual({
      mainnet: true,
      testnet3: false,
      testnet4: true,
      signet: true,
    });
  });

  it('keeps networks selectable when availability status cannot be read', async () => {
    vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('status failed'));

    await expect(getSidebarNetworkAvailability()).resolves.toEqual({
      mainnet: true,
      testnet3: true,
      testnet4: true,
      signet: true,
    });
  });
});
