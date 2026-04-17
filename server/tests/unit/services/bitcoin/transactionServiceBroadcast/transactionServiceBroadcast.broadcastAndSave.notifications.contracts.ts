import { broadcastRecipient as recipient, broadcastWalletId as walletId } from './transactionServiceBroadcast.broadcastAndSave.shared';
import { expect, it, vi, type Mock } from 'vitest';
import { createRawTxHex, flushPromises, mockEmitTransactionReceived, mockNotifyNewTransactions } from './transactionServiceBroadcastTestHarness';
import * as bitcoin from 'bitcoinjs-lib';
import { Prisma } from '../../../../../src/generated/prisma/client';
import { broadcastAndSave } from '../../../../../src/services/bitcoin/transactionService';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';

export const registerBroadcastAndSaveNotificationContracts = () => {
  it('should tolerate main wallet notification failures without failing broadcast', async () => {
    (mockPrismaClient.$transaction as Mock).mockImplementation(async () => ({
      txType: 'sent',
      mainTransactionCreated: true,
      unlockedCount: 0,
      createdReceivingTransactions: [],
    }));
    mockNotifyNewTransactions.mockRejectedValueOnce(new Error('main notification failed'));

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: createRawTxHex([{ address: recipient, value: 30_000 }]),
    };

    const result = await broadcastAndSave(walletId, undefined, metadata);
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
      createdReceivingTransactions: [{
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

    const result = await broadcastAndSave(walletId, undefined, metadata);
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

  it('should skip creating duplicate pending receive transaction records', async () => {
    const internalAddress = testnetAddresses.legacy[1];
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
      { address: internalAddress, value: 7_000 },
    ]);

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockResolvedValue([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'existing-received' });

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

    await broadcastAndSave(walletId, undefined, metadata);

    expect(mockPrismaClient.transaction.create).toHaveBeenCalledTimes(1);
  });

  it('should ignore unique-constraint races while creating pending receive records', async () => {
    const internalAddress = testnetAddresses.legacy[1];
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
      { address: internalAddress, value: 7_000 },
    ]);

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockResolvedValue([{ walletId: 'receiving-wallet-id', address: internalAddress }]);
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
    mockPrismaClient.transaction.create.mockResolvedValueOnce({
      id: 'tx-1',
      txid: 'new-txid-from-broadcast',
      walletId,
      type: 'sent',
    });
    mockPrismaClient.transaction.create.mockRejectedValueOnce(
      new Error('Unique constraint failed on the fields')
    );

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

    const result = await broadcastAndSave(walletId, undefined, metadata);
    expect(result.broadcasted).toBe(true);
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

    const result = await broadcastAndSave(walletId, undefined, metadata);
    expect(result.broadcasted).toBe(true);

    fromHexSpy.mockRestore();
  });

  it('reuses existing transaction record when create hits a unique constraint race', async () => {
    mockPrismaClient.transaction.create.mockReset();
    mockPrismaClient.transaction.create.mockRejectedValueOnce(
      new Error('Unique constraint failed on the fields')
    );
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

    const result = await broadcastAndSave(walletId, undefined, metadata);

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

  it('should rethrow unique-constraint errors when existing transaction record cannot be found', async () => {
    mockPrismaClient.transaction.create.mockReset();
    mockPrismaClient.transaction.create.mockRejectedValueOnce(
      new Error('Unique constraint failed on the fields')
    );
    mockPrismaClient.transaction.findUnique.mockResolvedValueOnce(null);

    const metadata = {
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    await expect(
      broadcastAndSave(walletId, undefined, metadata)
    ).rejects.toThrow('Unique constraint failed');
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

    await broadcastAndSave(walletId, undefined, metadata);

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

  it('should continue when creating internal receiving transaction fails with non-unique error', async () => {
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
    mockPrismaClient.transaction.create.mockRejectedValueOnce(new Error('db timeout'));

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

    const result = await broadcastAndSave(walletId, undefined, metadata);

    expect(result.broadcasted).toBe(true);
  });

  it('reuses existing transaction record for Prisma known unique-constraint errors', async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test-client',
    });

    mockPrismaClient.transaction.create.mockReset();
    mockPrismaClient.transaction.create.mockRejectedValueOnce(uniqueError);
    mockPrismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: 'existing-known-prisma',
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

    const result = await broadcastAndSave(walletId, undefined, metadata);

    expect(result.broadcasted).toBe(true);
    expect(mockPrismaClient.transaction.findUnique).toHaveBeenCalled();
  });

  it('should continue when internal wallet matching fails', async () => {
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

    const result = await broadcastAndSave(walletId, undefined, metadata);
    expect(result.broadcasted).toBe(true);
  });
};
