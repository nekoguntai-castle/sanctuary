import './transactionServiceBroadcastTestHarness';
import { type Mock } from 'vitest';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { testnetAddresses } from '../../../../fixtures/bitcoin';
import { broadcastAndSave as broadcastValidatedArtifact } from '../../../../../src/services/bitcoin/transactionService';
import { createValidatedBroadcastArtifactFixture } from '../../../../helpers/validatedBroadcastArtifact';

export const broadcastWalletId = 'test-wallet-id';
export const broadcastRecipient = testnetAddresses.nativeSegwit[0];
export const broadcastNetwork = 'testnet4' as const;

export const withBroadcastNetwork = <T extends object>(metadata: T): T & { network: typeof broadcastNetwork } => ({
  network: broadcastNetwork,
  ...metadata,
});

type LegacyBroadcastMetadata = Parameters<typeof broadcastValidatedArtifact>[1] & {
  network: typeof broadcastNetwork;
  rawTxHex: string;
};

/** Adapt persistence-focused legacy fixtures to the validated-artifact boundary. */
export const broadcastAndSave = async (
  walletId: string,
  _signedPsbtBase64: string | undefined,
  metadata: LegacyBroadcastMetadata,
) => {
  const { network, rawTxHex, ...persistenceMetadata } = metadata;
  const artifact = createValidatedBroadcastArtifactFixture({
    walletId,
    network,
    rawTx: rawTxHex,
    txid: 'new-txid-from-broadcast',
    intentId: 'intent-broadcast-persistence-test',
  });

  return broadcastValidatedArtifact(artifact, persistenceMetadata);
};

export const setupBroadcastAndSaveDefaults = () => {
  // Reset broadcast mock
  (broadcastTransaction as Mock).mockReset().mockResolvedValue({
    txid: 'new-txid-from-broadcast',
    broadcasted: true,
  });

  // Reset recalculateWalletBalances mock
  (recalculateWalletBalances as Mock).mockReset().mockResolvedValue(undefined);

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
