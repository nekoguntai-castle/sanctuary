import { broadcastRecipient as recipient, broadcastWalletId as walletId } from './transactionServiceBroadcast.broadcastAndSave.shared';
import { expect, it, vi } from 'vitest';
import { createRawTxHex, flushPromises, mockEmitTransactionReceived, mockEmitTransactionSent, mockNotifyNewTransactions } from './transactionServiceBroadcastTestHarness';
import * as bitcoin from 'bitcoinjs-lib';
import { broadcastAndSave } from '../../../../../src/services/bitcoin/transactionService';
import { recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import * as psbtBuilder from '../../../../../src/services/bitcoin/psbtBuilder';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';

export const registerBroadcastAndSavePsbtFallbackContracts = () => {
  it('should broadcast from signed PSBT and exercise finalization branches', async () => {
    const finalizeInput = vi.fn();
    const extractedRawTx = '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000';

    const fakePsbt = {
      data: {
        inputs: [
          { finalScriptWitness: Buffer.from('00', 'hex') },
          {
            witnessScript: Buffer.from('51ae', 'hex'),
            partialSig: [{ pubkey: Buffer.alloc(33, 2), signature: Buffer.from('300602010102010101', 'hex') }],
          },
          {
            witnessScript: Buffer.from('51ae', 'hex'),
            partialSig: [{ pubkey: Buffer.alloc(33, 3), signature: Buffer.from('300602010102010101', 'hex') }],
          },
          {},
        ],
      },
      finalizeInput,
      extractTransaction: vi.fn().mockReturnValue({
        toHex: () => extractedRawTx,
        getId: () => 'signed-psbt-txid',
      }),
    } as unknown as bitcoin.Psbt;

    const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64').mockReturnValue(fakePsbt);
    const parseMultisigSpy = vi.spyOn(psbtBuilder, 'parseMultisigScript')
      .mockReturnValueOnce({ isMultisig: true, m: 2, n: 2, pubkeys: [] })
      .mockReturnValueOnce({ isMultisig: false, m: 0, n: 0, pubkeys: [] });
    const finalizeMultisigSpy = vi.spyOn(psbtBuilder, 'finalizeMultisigInput').mockImplementation(() => undefined);

    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
    };

    const result = await broadcastAndSave(walletId, 'signed-psbt-base64', metadata);

    expect(result.broadcasted).toBe(true);
    expect(finalizeMultisigSpy).toHaveBeenCalledWith(fakePsbt, 1);
    expect(finalizeInput).toHaveBeenCalledWith(2);
    expect(finalizeInput).toHaveBeenCalledWith(3);

    finalizeMultisigSpy.mockRestore();
    parseMultisigSpy.mockRestore();
    fromBase64Spy.mockRestore();
  });

  it('should skip finalization when all PSBT inputs are already finalized', async () => {
    const finalizeInput = vi.fn();
    const extractedRawTx = '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000';

    const fakePsbt = {
      data: {
        inputs: [{ finalScriptWitness: Buffer.from('00', 'hex') }],
      },
      finalizeInput,
      extractTransaction: vi.fn().mockReturnValue({
        toHex: () => extractedRawTx,
        getId: () => 'already-finalized-txid',
      }),
    } as unknown as bitcoin.Psbt;

    const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64').mockReturnValue(fakePsbt);

    const metadata = {
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
    };

    const result = await broadcastAndSave(walletId, 'already-finalized-psbt', metadata);

    expect(result.broadcasted).toBe(true);
    expect(finalizeInput).not.toHaveBeenCalled();
    fromBase64Spy.mockRestore();
  });

  it('should build fallback transaction inputs from UTXO lookups', async () => {
    const metadata = {
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [
        { txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout },
        { txid: 'missing-utxo-txid', vout: 99 },
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

    mockPrismaClient.uTXO.findMany.mockResolvedValue([
      {
        ...sampleUtxos[0],
        walletId,
        spent: false,
        amount: BigInt(100_000),
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([]);

    await broadcastAndSave(walletId, undefined, metadata);

    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            txid: sampleUtxos[0].txid,
            vout: sampleUtxos[0].vout,
          }),
        ]),
      })
    );
  });

  it('should skip fallback output persistence when parsed transaction has no outputs', async () => {
    const metadata = {
      recipient,
      amount: 50_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: createRawTxHex([{ address: recipient, value: 50_000 }]),
    };

    const fromHexSpy = vi.spyOn(bitcoin.Transaction, 'fromHex').mockReturnValue({
      getId: () => 'new-txid-from-broadcast',
      outs: [],
    } as unknown as bitcoin.Transaction);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockResolvedValue([]);

    await broadcastAndSave(walletId, undefined, metadata);

    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
    fromHexSpy.mockRestore();
  });

  it('should use empty address fallback when internal mapping references a missing output address', async () => {
    const rawTxHex = createRawTxHex([{ address: recipient, value: 30_000 }]);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockImplementation((query: any) => {
      if (query?.where?.walletId === walletId) {
        return Promise.resolve([]);
      }
      if (query?.where?.walletId?.not === walletId) {
        return Promise.resolve([{ walletId: 'receiving-wallet-id', address: 'tb1qmissingoutputaddress' }]);
      }
      return Promise.resolve([]);
    });
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    const metadata = {
      recipient,
      amount: 30_000,
      fee: 1_000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex,
    };

    await broadcastAndSave(walletId, undefined, metadata);

    expect(mockEmitTransactionReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'receiving-wallet-id',
        address: '',
      })
    );
  });

  it('should parse fallback outputs and create pending receive records for internal wallets', async () => {
    const ourAddress = testnetAddresses.nativeSegwit[1];
    const internalAddress = testnetAddresses.legacy[1];
    const rawTxHex = createRawTxHex([
      { address: recipient, value: 30_000 },
      { address: ourAddress, value: 10_000 },
      { address: internalAddress, value: 7_000 },
    ]);

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.address.findMany.mockImplementation((query: any) => {
      if (query?.where?.walletId === walletId) {
        return Promise.resolve([{ address: ourAddress }]);
      }
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
    mockPrismaClient.transaction.create.mockResolvedValueOnce({
      id: 'received-tx-1',
      txid: 'new-txid-from-broadcast',
      walletId: 'receiving-wallet-id',
      type: 'received',
    });
    mockNotifyNewTransactions.mockRejectedValueOnce(new Error('notify failed (sender)'));
    mockNotifyNewTransactions.mockRejectedValueOnce(new Error('notify failed (receiver)'));

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

    await broadcastAndSave(walletId, undefined, metadata);
    await flushPromises();

    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ address: recipient, outputType: 'recipient' }),
          expect.objectContaining({ address: ourAddress, outputType: 'change' }),
          expect.objectContaining({ address: internalAddress, outputType: 'recipient' }),
        ]),
      })
    );
    expect(recalculateWalletBalances).toHaveBeenCalledWith('receiving-wallet-id');
    expect(mockEmitTransactionSent).toHaveBeenCalled();
    expect(mockEmitTransactionReceived).toHaveBeenCalled();
  });
};
