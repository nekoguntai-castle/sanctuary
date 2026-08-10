import {
  broadcastRecipient as recipient,
  broadcastWalletId as walletId,
  withBroadcastNetwork,
} from './transactionServiceBroadcast.broadcastAndSave.shared';
import { expect, it, vi, type Mock } from 'vitest';
import { createRawTxHex, flushPromises, mockEmitTransactionReceived, mockEmitTransactionSent, mockNotifyNewTransactions } from './transactionServiceBroadcastTestHarness';
import * as bitcoin from 'bitcoinjs-lib';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { broadcastAndSave } from '../../../../../src/services/bitcoin/transactionService';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';

export const registerBroadcastAndSaveNotificationContracts = () => {
  it('does not turn an accepted transaction into failure when event emission throws', async () => {
    (mockPrismaClient.$transaction as Mock).mockImplementation(async () => ({
      txType: 'sent',
      mainTransactionCreated: true,
      unlockedCount: 0,
      receivingTransactions: [],
    }));
    mockEmitTransactionSent.mockImplementationOnce(() => {
      throw new Error('event listener failed');
    });

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork({
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: createRawTxHex([{ address: recipient, value: 30_000 }]),
    }));

    expect(result).toMatchObject({ broadcasted: true, persistenceStatus: 'complete' });
  });

  it('should tolerate main wallet notification failures without failing broadcast', async () => {
    (mockPrismaClient.$transaction as Mock).mockImplementation(async () => ({
      txType: 'sent',
      mainTransactionCreated: true,
      unlockedCount: 0,
      receivingTransactions: [],
    }));
    mockNotifyNewTransactions.mockRejectedValueOnce(new Error('main notification failed'));

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: createRawTxHex([{ address: recipient, value: 30_000 }]),
    };

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));
    await flushPromises();
    if (typeof (vi as any).dynamicImportSettled === 'function') {
      await (vi as any).dynamicImportSettled();
    }
    await flushPromises();

    expect(result.broadcasted).toBe(true);
    expect(mockNotifyNewTransactions).toHaveBeenCalled();
    const [notifiedWalletId, notifications] = mockNotifyNewTransactions.mock.calls[0] ?? [];
    expect(notifiedWalletId).toBe(walletId);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'sent',
          feeSats: 1_000n,
        }),
      ])
    );
  });

  it('should notify receiving wallets from persisted records and tolerate notification failures', async () => {
    const receivingWalletId = 'receiving-wallet-id';
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
    ]);

    (mockPrismaClient.$transaction as Mock).mockImplementation(async () => ({
      txType: 'sent',
      mainTransactionCreated: false,
      unlockedCount: 0,
      receivingTransactions: [{
        status: 'created',
        walletId: receivingWalletId,
        amount: 7_000,
        address: testnetAddresses.legacy[1],
      }],
    }));
    mockNotifyNewTransactions.mockImplementation(async (targetWalletId: string) => {
      if (targetWalletId === receivingWalletId) {
        throw new Error('receiver notification failed');
      }
    });
    if (typeof (vi as any).dynamicImportSettled === 'function') {
      await (vi as any).dynamicImportSettled();
    }
    mockNotifyNewTransactions.mockClear();

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex,
    };

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));
    await flushPromises();
    if (typeof (vi as any).dynamicImportSettled === 'function') {
      await (vi as any).dynamicImportSettled();
    }
    await flushPromises();

    expect(result.broadcasted).toBe(true);
    expect(mockEmitTransactionReceived).toHaveBeenCalledWith(expect.objectContaining({
      walletId: receivingWalletId,
      amount: 7_000n,
    }));
    expect(mockNotifyNewTransactions).toHaveBeenCalledWith(
      receivingWalletId,
      expect.arrayContaining([
        expect.objectContaining({
          txid: result.txid,
          type: 'received',
          amount: 7_000n,
        }),
      ])
    );
  });

  it('repairs balance and output detail without repeating events for an existing receive', async () => {
    const internalAddress = testnetAddresses.legacy[1];
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
      { address: internalAddress, value: 7_000 },
    ]);

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockResolvedValue([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
    mockPrismaClient.transaction.createManyAndReturn.mockResolvedValueOnce([]);
    mockPrismaClient.transaction.findUnique.mockResolvedValueOnce({ id: 'existing-received' });

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      inputs: [
        {
          txid: sampleUtxos[0].txid,
          vout: sampleUtxos[0].vout,
          address: sampleUtxos[0].address,
          amount: Number(sampleUtxos[0].amount),
        },
      ],
      outputs: [
        {
          address: recipient,
          amount: 30_000,
          outputType: 'recipient' as const,
          isOurs: false,
        },
      ],
      rawTxHex,
    };

    await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledTimes(1);
    expect(recalculateWalletBalances).toHaveBeenCalledWith('receiving-wallet-id');
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ transactionId: 'existing-received', address: internalAddress }),
        ]),
      })
    );
    expect(mockEmitTransactionReceived).not.toHaveBeenCalled();
  });

  it('aggregates multiple outputs owned by one receiving wallet', async () => {
    const internalAddress = testnetAddresses.legacy[1];
    const rawTxHex = createRawTxHex([
      { address: internalAddress, value: 4_000 },
      { address: internalAddress, value: 8_000 },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { walletId: 'receiving-wallet-id', address: internalAddress },
    ]);
    mockPrismaClient.transaction.createManyAndReturn.mockResolvedValueOnce([
      { id: 'aggregated-receive' },
    ]);

    await broadcastAndSave(walletId, undefined, withBroadcastNetwork({
      recipient: internalAddress,
      amount: 12_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      outputs: [{
        address: internalAddress,
        amount: 12_000,
        outputType: 'recipient' as const,
        isOurs: false,
      }],
      rawTxHex,
    }));

    expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ walletId: 'receiving-wallet-id', amount: 12_000n })],
      })
    );
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ transactionId: 'aggregated-receive', amount: 4_000n }),
          expect.objectContaining({ transactionId: 'aggregated-receive', amount: 8_000n }),
        ],
      })
    );
    expect(mockEmitTransactionReceived).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'receiving-wallet-id', amount: 12_000n })
    );
  });

  it('creates independent pending rows for multiple receiving wallets', async () => {
    const firstAddress = testnetAddresses.legacy[1];
    const secondAddress = testnetAddresses.nativeSegwit[1];
    const rawTxHex = createRawTxHex([
      { address: firstAddress, value: 4_000 },
      { address: secondAddress, value: 8_000 },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { walletId: 'receiving-wallet-a', address: firstAddress },
      { walletId: 'receiving-wallet-b', address: secondAddress },
    ]);
    mockPrismaClient.transaction.createManyAndReturn
      .mockResolvedValueOnce([{ id: 'receive-a' }])
      .mockResolvedValueOnce([{ id: 'receive-b' }]);

    await broadcastAndSave(walletId, undefined, withBroadcastNetwork({
      recipient: firstAddress,
      amount: 12_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      outputs: [{
        address: firstAddress,
        amount: 12_000,
        outputType: 'recipient' as const,
        isOurs: false,
      }],
      rawTxHex,
    }));

    expect(mockEmitTransactionReceived).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'receiving-wallet-a', amount: 4_000n })
    );
    expect(mockEmitTransactionReceived).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'receiving-wallet-b', amount: 8_000n })
    );
  });

  it('returns accepted reconciliation state when a duplicate receive cannot be resolved', async () => {
    const internalAddress = testnetAddresses.legacy[1];
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
      { address: internalAddress, value: 7_000 },
    ]);

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockResolvedValue([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
    mockPrismaClient.transaction.createManyAndReturn.mockResolvedValueOnce([]);
    mockPrismaClient.transaction.findUnique.mockResolvedValueOnce(null);
    mockPrismaClient.transaction.create.mockResolvedValueOnce({
      id: 'tx-1',
      txid: 'new-txid-from-broadcast',
      walletId,
      type: 'sent',
    });

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      inputs: [
        {
          txid: sampleUtxos[0].txid,
          vout: sampleUtxos[0].vout,
          address: sampleUtxos[0].address,
          amount: Number(sampleUtxos[0].amount),
        },
      ],
      outputs: [
        {
          address: recipient,
          amount: 30_000,
          outputType: 'recipient' as const,
          isOurs: false,
        },
      ],
      rawTxHex,
    };

    await expect(
      broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata))
    ).resolves.toMatchObject({
      broadcasted: true,
      persistenceStatus: 'pending_reconciliation',
      persistenceReason: 'post_acceptance_persistence_race',
    });
  });

  it('should continue when fallback raw transaction output parsing fails', async () => {
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
    ]);
    const originalFromHex = bitcoin.Transaction.fromHex;
    const fromHexSpy = vi.spyOn(bitcoin.Transaction, 'fromHex');
    fromHexSpy
      .mockImplementationOnce((hex: string) => originalFromHex(hex))
      .mockImplementationOnce(() => {
        throw new Error('raw output parse failure');
      })
      .mockImplementation((hex: string) => originalFromHex(hex));

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      inputs: [
        {
          txid: sampleUtxos[0].txid,
          vout: sampleUtxos[0].vout,
          address: sampleUtxos[0].address,
          amount: Number(sampleUtxos[0].amount),
        },
      ],
      rawTxHex,
    };

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));
    expect(result.broadcasted).toBe(true);

    fromHexSpy.mockRestore();
  });

  it('reuses an existing sender transaction without raising a PostgreSQL unique violation', async () => {
    mockPrismaClient.transaction.createMany.mockResolvedValueOnce({ count: 0 });
    mockPrismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: 'existing-tx-id',
      txid: 'new-txid-from-broadcast',
      walletId,
      type: 'sent',
      amount: BigInt(-51_000),
      fee: BigInt(1_000),
      confirmations: 0,
    });

    const metadata = {
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      inputs: [
        {
          txid: sampleUtxos[0].txid,
          vout: sampleUtxos[0].vout,
          address: sampleUtxos[0].address,
          amount: Number(sampleUtxos[0].amount),
        },
      ],
      outputs: [
        {
          address: recipient,
          amount: 50_000,
          outputType: 'recipient' as const,
          isOurs: false,
        },
      ],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

    expect(result.broadcasted).toBe(true);
    expect(mockPrismaClient.transaction.findUnique).toHaveBeenCalled();
    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            transactionId: 'existing-tx-id',
          }),
        ]),
      })
    );
  });

  it('returns accepted reconciliation state when a skipped sender insert cannot be resolved', async () => {
    mockPrismaClient.transaction.createMany.mockResolvedValueOnce({ count: 0 });
    mockPrismaClient.transaction.findUnique.mockResolvedValueOnce(null);

    const metadata = {
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    await expect(
      broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata))
    ).resolves.toMatchObject({
      broadcasted: true,
      persistenceStatus: 'pending_reconciliation',
    });
  });

  it('should classify fallback parsed wallet-owned output as consolidation output type', async () => {
    const internalWalletAddress = testnetAddresses.legacy[1];
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
      { address: internalWalletAddress, value: 7_000 },
    ]);

    mockPrismaClient.address.findFirst.mockResolvedValue({
      id: 'consolidation-addr',
      walletId,
      address: recipient,
    });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockImplementation((query: any) => {
      if (query?.where?.walletId === walletId) {
        return Promise.resolve([{ address: recipient }, { address: internalWalletAddress }]);
      }
      if (query?.where?.walletId?.not === walletId) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex,
    };

    await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            address: internalWalletAddress,
            outputType: 'consolidation',
            isOurs: true,
          }),
        ]),
      })
    );
  });

  it('returns accepted reconciliation state when receiver persistence fails', async () => {
    const internalAddress = testnetAddresses.legacy[1];
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
      { address: internalAddress, value: 7_000 },
    ]);

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockImplementation((query: any) => {
      if (query?.where?.walletId?.not === walletId) {
        return Promise.resolve([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
      }
      return Promise.resolve([]);
    });
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
    mockPrismaClient.transaction.create.mockResolvedValueOnce({
      id: 'tx-1',
      txid: 'new-txid-from-broadcast',
      walletId,
      type: 'sent',
    });
    mockPrismaClient.transaction.createManyAndReturn.mockRejectedValueOnce(new Error('db timeout'));

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      outputs: [
        {
          address: recipient,
          amount: 30_000,
          outputType: 'recipient' as const,
          isOurs: false,
        },
      ],
      rawTxHex,
    };

    await expect(
      broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata))
    ).resolves.toMatchObject({
      broadcasted: true,
      persistenceStatus: 'pending_reconciliation',
    });
  });

  it('retries known transaction conflicts in fresh transactions without rebroadcasting', async () => {
    const writeConflict = new PrismaClientKnownRequestError('Write conflict', {
      code: 'P2034',
      clientVersion: 'test-client',
    });
    mockPrismaClient.$transaction
      .mockRejectedValueOnce(writeConflict)
      .mockRejectedValueOnce(writeConflict)
      .mockImplementationOnce(async callback => callback(mockPrismaClient));

    const metadata = {
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      inputs: [
        {
          txid: sampleUtxos[0].txid,
          vout: sampleUtxos[0].vout,
          address: sampleUtxos[0].address,
          amount: Number(sampleUtxos[0].amount),
        },
      ],
      outputs: [
        {
          address: recipient,
          amount: 50_000,
          outputType: 'recipient' as const,
          isOurs: false,
        },
      ],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

    expect(result).toMatchObject({ broadcasted: true, persistenceStatus: 'complete' });
    expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(3);
    expect(broadcastTransaction).toHaveBeenCalledTimes(1);
  });

  it('retries driver-adapter transaction conflicts', async () => {
    const writeConflict = new PrismaClientKnownRequestError('Write conflict', {
      code: 'P2010',
      clientVersion: 'test-client',
      meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } },
    });
    mockPrismaClient.$transaction
      .mockRejectedValueOnce(writeConflict)
      .mockImplementationOnce(async callback => callback(mockPrismaClient));

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork({
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    }));

    expect(result.persistenceStatus).toBe('complete');
    expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry generic Prisma raw-query failures', async () => {
    const rawQueryFailure = new PrismaClientKnownRequestError('Raw query failed', {
      code: 'P2010',
      clientVersion: 'test-client',
    });
    mockPrismaClient.$transaction.mockRejectedValueOnce(rawQueryFailure);

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork({
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    }));

    expect(result.persistenceStatus).toBe('pending_reconciliation');
    expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns accepted reconciliation state when internal wallet matching fails', async () => {
    mockPrismaClient.wallet.findUnique.mockRejectedValueOnce(new Error('wallet lookup failed'));

    const metadata = {
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      inputs: [
        {
          txid: sampleUtxos[0].txid,
          vout: sampleUtxos[0].vout,
          address: sampleUtxos[0].address,
          amount: Number(sampleUtxos[0].amount),
        },
      ],
      outputs: [
        {
          address: recipient,
          amount: 50_000,
          outputType: 'recipient' as const,
          isOurs: false,
        },
      ],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    await expect(
      broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata))
    ).resolves.toMatchObject({ persistenceStatus: 'pending_reconciliation' });
  });

  it('returns accepted reconciliation state when the sending wallet disappears', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(null);
    const rawTxHex = createRawTxHex([{ address: recipient, value: 50_000 }]);

    await expect(broadcastAndSave(walletId, undefined, withBroadcastNetwork({
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      outputs: [{
        address: recipient,
        amount: 50_000,
        outputType: 'recipient' as const,
        isOurs: false,
      }],
      rawTxHex,
    }))).resolves.toMatchObject({ persistenceStatus: 'pending_reconciliation' });
  });
};
