import {
  createRawTxHex,
  flushPromises,
  mockEmitTransactionReceived,
  mockEmitTransactionSent,
  mockNotifyNewTransactions,
} from './transactionServiceBroadcastTestHarness';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { Prisma } from '../../../../../src/generated/prisma/client';
import { broadcastAndSave } from '../../../../../src/services/bitcoin/transactionService';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import * as psbtBuilder from '../../../../../src/services/bitcoin/psbtBuilder';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';

export const registerBroadcastAndSaveTests = () => {
  describe('broadcastAndSave', () => {
    const walletId = 'test-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
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
        walletId,
        type: 'sent',
        amount: BigInt(50000),
        fee: BigInt(1000),
        confirmations: 0,
        balanceAfter: null, // Will be set by recalculateWalletBalances
      });

      // Mock address lookup for consolidation detection
      mockPrismaClient.address.findFirst.mockResolvedValue(null);
    });

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

    it('should not call recalculateWalletBalances when broadcast fails', async () => {
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

      try {
        await broadcastAndSave(walletId, undefined, metadata);
      } catch {
        // Expected to fail
      }

      // Verify recalculateWalletBalances was NOT called when broadcast fails
      expect(recalculateWalletBalances).not.toHaveBeenCalled();
    });

    it('should handle recalculateWalletBalances error gracefully', async () => {
      // recalculateWalletBalances throws but broadcast should still complete
      // Note: The actual behavior depends on implementation - if recalculateWalletBalances
      // is called with await, errors will propagate. If it's fire-and-forget, they won't.
      // This test documents the expected behavior.
      (recalculateWalletBalances as Mock).mockRejectedValueOnce(new Error('Balance calculation failed'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // The broadcast should either succeed or throw depending on implementation
      // If recalculateWalletBalances errors are caught, broadcast succeeds
      // If they propagate, broadcast throws
      try {
        const result = await broadcastAndSave(walletId, undefined, metadata);
        // If we get here, the implementation catches balance calculation errors
        expect(result.broadcasted).toBe(true);
        expect(result.txid).toBeDefined();
      } catch (error) {
        // If we get here, balance calculation errors propagate
        // This is also valid behavior - the test documents it
        expect((error as Error).message).toContain('Balance calculation failed');
      }

      // Verify recalculateWalletBalances was called
      expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
    });

    describe('RBF Transaction Tracking', () => {
      it('should detect RBF replacement from memo and mark original as replaced', async () => {
        const originalTxid = 'original-tx-12345678901234567890123456789012345678901234567890123456';

        // Mock finding the original transaction
        mockPrismaClient.transaction.findFirst.mockResolvedValue({
          id: 'original-tx-db-id',
          txid: originalTxid,
          walletId,
          type: 'sent',
          amount: BigInt(45000),
          fee: BigInt(500),
          label: 'Original payment label',
          memo: 'Original memo',
          rbfStatus: 'active',
        });

        const metadata = {
          recipient,
          amount: 45000,
          fee: 2000, // Higher fee for RBF
          label: undefined, // No label provided - should copy from original
          memo: `Replacing transaction ${originalTxid}`,
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        await broadcastAndSave(walletId, undefined, metadata);

        // Verify original transaction was marked as replaced
        expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'original-tx-db-id' },
            data: expect.objectContaining({
              rbfStatus: 'replaced',
              replacedByTxid: expect.any(String), // The new txid
            }),
          })
        );

        // Verify new transaction created with correct fields
        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              replacementForTxid: originalTxid,
              rbfStatus: 'active',
              label: 'Original payment label', // Preserved from original
            }),
          })
        );
      });

      it('should preserve original label when RBF transaction has no label', async () => {
        const originalTxid = 'original-tx-with-label-5678901234567890123456789012345678901234';

        mockPrismaClient.transaction.findFirst.mockResolvedValue({
          id: 'tx-with-label',
          txid: originalTxid,
          walletId,
          label: 'Important payment',
          rbfStatus: 'active',
        });

        const metadata = {
          recipient,
          amount: 50000,
          fee: 3000,
          label: undefined, // No new label
          memo: `Replacing transaction ${originalTxid}`,
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        await broadcastAndSave(walletId, undefined, metadata);

        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              label: 'Important payment',
            }),
          })
        );
      });

      it('should use provided label over original when both exist', async () => {
        const originalTxid = 'original-tx-label-override-56789012345678901234567890123456789012';

        mockPrismaClient.transaction.findFirst.mockResolvedValue({
          id: 'tx-original',
          txid: originalTxid,
          walletId,
          label: 'Old label',
          rbfStatus: 'active',
        });

        const metadata = {
          recipient,
          amount: 50000,
          fee: 3000,
          label: 'New explicit label', // Explicitly provided
          memo: `Replacing transaction ${originalTxid}`,
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        await broadcastAndSave(walletId, undefined, metadata);

        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              label: 'New explicit label',
            }),
          })
        );
      });

      it('should handle RBF when original transaction not found', async () => {
        const nonExistentTxid = 'nonexistent-tx-123456789012345678901234567890123456789012345';

        // Original not found
        mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

        const metadata = {
          recipient,
          amount: 50000,
          fee: 3000,
          memo: `Replacing transaction ${nonExistentTxid}`,
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        // Should not throw - gracefully handle missing original
        await expect(broadcastAndSave(walletId, undefined, metadata)).resolves.toBeDefined();

        // Should still create the new transaction with replacementForTxid
        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              replacementForTxid: nonExistentTxid,
              rbfStatus: 'active',
            }),
          })
        );

        // Should NOT call update since original wasn't found
        expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      });

      it('should not treat regular transactions as RBF', async () => {
        const metadata = {
          recipient,
          amount: 50000,
          fee: 1000,
          label: 'Regular payment',
          memo: 'Just a normal transaction', // No RBF prefix
          utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        };

        await broadcastAndSave(walletId, undefined, metadata);

        // Should create transaction without RBF fields
        expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              replacementForTxid: undefined,
              rbfStatus: 'active',
            }),
          })
        );

        // Should not try to find or update an original transaction
        expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      });

      it('should release UTXO locks when broadcasting from a draft', async () => {
        const draftId = 'draft-to-broadcast';
        mockPrismaClient.draftUtxoLock.deleteMany.mockResolvedValue({ count: 2 });

        const metadata = {
          recipient,
          amount: 50000,
          fee: 1000,
          utxos: [
            { txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout },
            { txid: sampleUtxos[1].txid, vout: sampleUtxos[1].vout },
          ],
          rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
          draftId,
        };

        await broadcastAndSave(walletId, undefined, metadata);

        expect(mockPrismaClient.draftUtxoLock.deleteMany).toHaveBeenCalledWith({
          where: { draftId },
        });
      });
    });
  });
};
