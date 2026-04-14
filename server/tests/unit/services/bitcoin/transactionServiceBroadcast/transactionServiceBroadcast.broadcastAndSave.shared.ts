import './transactionServiceBroadcastTestHarness';
import { type Mock } from 'vitest';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { testnetAddresses } from '../../../../fixtures/bitcoin';

export const broadcastWalletId = 'test-wallet-id';
export const broadcastRecipient = testnetAddresses.nativeSegwit[0];

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

  // Mock transaction create
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
};
