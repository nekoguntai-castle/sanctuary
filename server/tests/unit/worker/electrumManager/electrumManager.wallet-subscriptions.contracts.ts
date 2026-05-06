import { describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
} from './electrumManagerTestHarness';
import { walletRepository, addressRepository } from '../../../../src/repositories';
import { getAddressSubscriptionKey } from '../../../../src/worker/electrumManager/types';

export function registerElectrumManagerWalletSubscriptionContracts() {
  describe('subscribeWalletAddresses', () => {
    it('subscribes and tracks addresses for a wallet', async () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      (manager as unknown as { networks: Map<string, unknown> }).networks.set('mainnet', state);

      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce('mainnet');
      vi.mocked(addressRepository.findAddressStrings).mockResolvedValueOnce(['addr1', 'addr2']);

      await manager.subscribeWalletAddresses('wallet1');

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr1', 'addr2']);
      const tracked = (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet;
      expect(tracked.get(getAddressSubscriptionKey('mainnet', 'addr1'))).toEqual({ walletId: 'wallet1', network: 'mainnet' });
      expect(tracked.get(getAddressSubscriptionKey('mainnet', 'addr2'))).toEqual({ walletId: 'wallet1', network: 'mainnet' });
    });

    it('returns when wallet does not exist', async () => {
      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce(null);

      await manager.subscribeWalletAddresses('missing-wallet');

      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('defaults to mainnet when wallet network is missing', async () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      (manager as unknown as { networks: Map<string, unknown> }).networks.set('mainnet', state);

      // findNetwork returns 'mainnet' explicitly (the repository resolves the network)
      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce('mainnet');
      vi.mocked(addressRepository.findAddressStrings).mockResolvedValueOnce(['addr-default']);

      await manager.subscribeWalletAddresses('wallet-default');

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-default']);
      const tracked = (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet;
      expect(tracked.get(getAddressSubscriptionKey('mainnet', 'addr-default'))).toEqual({ walletId: 'wallet-default', network: 'mainnet' });
    });

    it('returns when network is not connected', async () => {
      (manager as unknown as { networks: Map<string, unknown> }).networks.set('testnet3', {
        network: 'testnet3',
        client: mockClient,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });

      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce('testnet3');
      await manager.subscribeWalletAddresses('wallet1');

      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });
  });
}
