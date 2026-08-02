import './transactionServiceBroadcastTestHarness';
import { type Mock } from 'vitest';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { testnetAddresses } from '../../../../fixtures/bitcoin';

export const broadcastWalletId = 'test-wallet-id';
export const broadcastRecipient = testnetAddresses.nativeSegwit[0];
export const broadcastNetwork = 'testnet4' as const;

export const withBroadcastNetwork = <T extends object>(metadata: T): T & { network: typeof broadcastNetwork } => ({
  network: broadcastNetwork,
  ...metadata,
});

export const setupBroadcastAndSaveDefaults = () => {
  // Reset broadcast mock
  (broadcastTransaction as Mock).mockResolvedValue({
    txid: 'new-txid-from-broadcast',
    broadcasted: true,
  });

  // Reset recalculateWalletBalances mock
  (recalculateWalletBalances as Mock).mockResolvedValue(undefined);

  // Mock UTXO update
  mockPrismaClient.uTXO.update.mockResolvedValue({});

  // Mock sender transaction insert
  mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 1 });
  mockPrismaClient.transaction.create.mockResolvedValue({
    id: 'tx-1',
    txid: 'new-txid-from-broadcast',
    walletId: broadcastWalletId,
    type: 'sent',
    amount: BigInt(50000),
    fee: BigInt(1000),
    confirmations: 0,
    balanceAfter: null, // Will be set by recalculateWalletBalances
  });

  // Mock address lookup for consolidation detection
  mockPrismaClient.address.findFirst.mockResolvedValue(null);
  mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet4' });
};
