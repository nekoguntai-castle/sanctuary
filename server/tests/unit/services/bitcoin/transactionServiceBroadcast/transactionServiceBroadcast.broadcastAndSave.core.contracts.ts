import { broadcastRecipient as recipient, broadcastWalletId as walletId } from './transactionServiceBroadcast.broadcastAndSave.shared';
import { expect, it, type Mock } from 'vitest';
import { broadcastAndSave } from '../../../../../src/services/bitcoin/transactionService';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos } from '../../../../fixtures/bitcoin';

export const registerBroadcastAndSaveCoreContracts = () => {
  it('should broadcast signed PSBT and save transaction to database', async () => {
    // Test the database save and UTXO update behavior using rawTxHex path
    // Note: Testing the actual PSBT parsing requires a finalized signed PSBT
    // which is complex to create in tests. The rawTxHex and PSBT paths share
    // the same database logic, so this effectively tests that code path.

    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      label: 'Test payment',
      memo: 'Testing broadcast',
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    const result = await broadcastAndSave(walletId, undefined, metadata);

    expect(result.broadcasted).toBe(true);
    expect(result.txid).toBeDefined();
    expect(mockPrismaClient.uTXO.update).toHaveBeenCalled();
    expect(mockPrismaClient.transaction.create).toHaveBeenCalled();

    // Verify the transaction was created with correct data
    // Note: For sent transactions, amount is stored as negative (amount + fee)
    expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          walletId,
          type: 'sent',
          amount: BigInt(-51000), // -(50000 + 1000 fee)
          fee: BigInt(1000),
          label: 'Test payment',
          memo: 'Testing broadcast',
        }),
      })
    );
  });

  it('should handle Trezor raw transaction hex path', async () => {
    // Raw transaction hex (signed by Trezor)
    const rawTxHex = '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000';

    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex,
    };

    const result = await broadcastAndSave(walletId, undefined, metadata);

    expect(result.broadcasted).toBe(true);
    expect(result.txid).toBeDefined();
    expect(broadcastTransaction).toHaveBeenCalled();
  });

  it('should mark spent UTXOs after broadcast', async () => {
    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [
        { txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout },
        { txid: sampleUtxos[1].txid, vout: sampleUtxos[1].vout },
      ],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    await broadcastAndSave(walletId, undefined, metadata);

    // Should update each UTXO as spent
    expect(mockPrismaClient.uTXO.update).toHaveBeenCalledTimes(2);
    expect(mockPrismaClient.uTXO.update).toHaveBeenCalledWith({
      where: {
        txid_vout: {
          txid: sampleUtxos[0].txid,
          vout: sampleUtxos[0].vout,
        },
      },
      data: { spent: true },
    });
  });

  it('should detect consolidation vs sent transaction', async () => {
    // Mock recipient is a wallet address (consolidation)
    mockPrismaClient.address.findFirst.mockResolvedValue({
      id: 'addr-1',
      address: recipient,
      walletId,
    });

    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    await broadcastAndSave(walletId, undefined, metadata);

    // Transaction should be created with type 'consolidation'
    expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'consolidation',
        }),
      })
    );
  });

  it('should throw error when neither PSBT nor rawTxHex provided', async () => {
    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
    };

    await expect(
      broadcastAndSave(walletId, undefined, metadata)
    ).rejects.toThrow('Either signedPsbtBase64 or rawTxHex is required');
  });

  it('should throw error when broadcast fails', async () => {
    (broadcastTransaction as Mock).mockResolvedValue({
      txid: null,
      broadcasted: false,
    });

    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    await expect(
      broadcastAndSave(walletId, undefined, metadata)
    ).rejects.toThrow('Failed to broadcast transaction');
  });

  it('should call recalculateWalletBalances after successful broadcast', async () => {
    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    await broadcastAndSave(walletId, undefined, metadata);

    // Verify recalculateWalletBalances was called with the correct walletId
    expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
  });

  it('should persist provided transaction inputs and outputs metadata directly', async () => {
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
          derivationPath: "m/84'/1'/0'/0/0",
        },
      ],
      outputs: [
        {
          address: recipient,
          amount: 50_000,
          outputType: 'recipient' as const,
          isOurs: false,
          scriptPubKey: '0014' + 'ff'.repeat(20),
        },
      ],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    await broadcastAndSave(walletId, undefined, metadata);

    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            address: sampleUtxos[0].address,
            derivationPath: "m/84'/1'/0'/0/0",
          }),
        ]),
      })
    );
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            address: recipient,
            outputType: 'recipient',
            isOurs: false,
          }),
        ]),
      })
    );
  });
};
