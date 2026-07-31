import { expect, it, vi, type Mock } from 'vitest';
import './processTransactionsTestHarness';
import { mockPrismaClient } from '../../../../../mocks/prisma';
import {
  mockElectrumClient,
  createMockTransaction,
  createMockUTXO,
} from '../../../../../mocks/electrum';
import {
  createTestContext,
  processTransactionsPhase,
  type SyncContext,
} from '../../../../../../src/services/bitcoin/sync';
import {
  correctMisclassifiedConsolidations,
  recalculateWalletBalances,
} from '../../../../../../src/services/bitcoin/utils/balanceCalculation';
import { getBlockTimestamp } from '../../../../../../src/services/bitcoin/utils/blockHeight';
import { getNotificationService, walletLog } from '../../../../../../src/websocket/notifications';
import { notifyNewTransactions } from '../../../../../../src/services/notifications/notificationService';

export function registerProcessTransactionClassificationTests(walletId: string): void {
    it('skips balance work when no transaction candidates or durable repair remain', async () => {
      const ctx = createTestContext({
        walletId,
        newTxids: [],
        historyResults: new Map(),
      });

      const result = await processTransactionsPhase(ctx);

      expect(result.stats.newTransactionsCreated).toBe(0);
      expect(mockPrismaClient.transaction.createManyAndReturn).not.toHaveBeenCalled();
      expect(recalculateWalletBalances).not.toHaveBeenCalled();
    });

    it('retries balance recalculation after a post-commit failure', async () => {
      const ctx = createTestContext({
        walletId,
        newTxids: [],
        historyResults: new Map(),
      });
      mockPrismaClient.$queryRaw.mockResolvedValue([{ pending: true }]);
      (recalculateWalletBalances as Mock)
        .mockRejectedValueOnce(new Error('balance update failed'))
        .mockResolvedValueOnce(undefined);

      await expect(processTransactionsPhase(ctx)).rejects.toThrow('balance update failed');
      await expect(processTransactionsPhase(ctx)).resolves.toBe(ctx);

      expect(recalculateWalletBalances).toHaveBeenCalledTimes(2);
      expect(recalculateWalletBalances).toHaveBeenNthCalledWith(2, walletId);
    });

    it('should classify transaction as received when external inputs only', async () => {
      const txid = 'received_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';

      // Mock transaction with external input, output to wallet
      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev_tx'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress }],
        outputs: [{ value: 0.00099, address: walletAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'received',
              amount: BigInt(99000), // 0.00099 BTC in sats
              classificationInputsComplete: true,
            }),
          ]),
        })
      );
    });

    it('marks a partial multi-input classification incomplete until every input resolves', async () => {
      const txid = 'partial_multi_input'.padEnd(64, 'a');
      const walletAddress = 'tb1q_partial_wallet';
      const externalAddress = 'tb1q_partial_external';
      const transaction = createMockTransaction({
        txid,
        inputs: [
          { txid: 'resolved_prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress },
          { txid: 'missing_prev'.padEnd(64, 'c'), vout: 0, value: 0.002, address: walletAddress },
        ],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });
      transaction.vin[1].prevout = undefined;
      mockElectrumClient.getTransactionsBatch
        .mockResolvedValueOnce(new Map([[txid, transaction]]))
        .mockResolvedValueOnce(new Map());
      mockElectrumClient.getTransaction.mockResolvedValue(undefined);

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-partial', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'received',
            classificationInputsComplete: false,
          })],
        })
      );
    });

    it('keeps value-known ownership-missing input evidence in the repair rotation', async () => {
      const txid = 'missing_input_owner'.padEnd(64, 'a');
      const walletAddress = 'tb1q_missing_owner_wallet';
      const transaction = createMockTransaction({
        txid,
        inputs: [{
          txid: 'missing_owner_prev'.padEnd(64, 'b'),
          vout: 0,
          value: 0.001,
          address: 'placeholder',
        }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });
      transaction.vin[0].prevout!.scriptPubKey = { hex: '0014-addressless' };
      mockElectrumClient.getTransactionsBatch
        .mockResolvedValueOnce(new Map([[txid, transaction]]))
        .mockResolvedValueOnce(new Map());
      mockElectrumClient.getTransaction.mockResolvedValue(undefined);

      await processTransactionsPhase(createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'missing-owner-address' } as any]]),
        txDetailsCache: new Map() as any,
      }));

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'received',
            amount: BigInt(90_000),
            classificationInputsComplete: false,
            classificationVersion: 2,
          })],
        })
      );
    });

    it('fills an inline-address missing value from its referenced output', async () => {
      const txid = 'missing_inline_value'.padEnd(64, 'a');
      const previousTxid = 'inline_value_prev'.padEnd(64, 'b');
      const walletAddress = 'tb1q_inline_value_wallet';
      const externalAddress = 'tb1q_inline_value_external';
      const transaction = createMockTransaction({
        txid,
        inputs: [{ txid: previousTxid, vout: 0, value: 0.001, address: walletAddress }],
        outputs: [{ value: 0.0009, address: externalAddress }],
      });
      delete transaction.vin[0].prevout!.value;
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));
      mockElectrumClient.getTransaction.mockResolvedValue({
        txid: previousTxid,
        vin: [],
        vout: [{
          value: 0.001,
          n: 0,
          scriptPubKey: { address: walletAddress },
        }],
      });

      await processTransactionsPhase(createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'inline-value-address' } as any]]),
        txDetailsCache: new Map() as any,
      }));

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'sent',
            amount: BigInt(-100_000),
            fee: BigInt(10_000),
            classificationInputsComplete: true,
          })],
        })
      );
    });

    it('uses wallet delta for a complete mixed-owner Payjoin receive', async () => {
      const txid = 'complete_multi_input'.padEnd(64, 'a');
      const walletAddress = 'tb1q_complete_wallet';
      const externalAddress = 'tb1q_complete_external';
      const transaction = createMockTransaction({
        txid,
        inputs: [
          { txid: 'external_prev'.padEnd(64, 'b'), vout: 0, value: 0.002, address: externalAddress },
          { txid: 'wallet_prev'.padEnd(64, 'c'), vout: 0, value: 0.001, address: walletAddress },
        ],
        outputs: [
          { value: 0.0015, address: externalAddress },
          { value: 0.0014, address: walletAddress },
        ],
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-complete', address: walletAddress } as any]]),
        existingTxMap: new Map([[`${txid}:received`, true]]),
        existingTxidSet: new Set([txid]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'received',
            amount: BigInt(40_000),
            classificationInputsComplete: true,
            classificationVersion: 2,
          })],
        })
      );
    });

    it('uses wallet delta and whole fee metadata for a mixed-owner Payjoin send', async () => {
      const txid = 'payjoin_sender'.padEnd(64, 'a');
      const walletAddress = 'tb1q_payjoin_sender_wallet';
      const externalAddress = 'tb1q_payjoin_sender_external';
      const transaction = createMockTransaction({
        txid,
        inputs: [
          { txid: 'wallet_prev'.padEnd(64, 'b'), vout: 0, value: 0.002, address: walletAddress },
          { txid: 'external_prev'.padEnd(64, 'c'), vout: 0, value: 0.003, address: externalAddress },
        ],
        outputs: [
          { value: 0.0035, address: externalAddress },
          { value: 0.0014, address: walletAddress },
        ],
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));

      await processTransactionsPhase(createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'payjoin-sender-address' } as any]]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      }));

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'sent',
            amount: BigInt(-60_000),
            fee: BigInt(10_000),
            classificationInputsComplete: true,
            classificationVersion: 2,
          })],
        })
      );
    });

    it('records an OP_RETURN-only wallet spend as sent with its exact fee delta', async () => {
      const txid = 'op_return_only'.padEnd(64, 'a');
      const walletAddress = 'tb1q_op_return_wallet';
      const transaction = createMockTransaction({
        txid,
        inputs: [{
          txid: 'op_return_prev'.padEnd(64, 'b'),
          vout: 0,
          value: 0.001,
          address: walletAddress,
        }],
        outputs: [{ value: 0, address: 'placeholder' }],
      });
      transaction.vout[0].scriptPubKey = { hex: '6a026869' };
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));

      await processTransactionsPhase(createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'op-return-address' } as any]]),
        txDetailsCache: new Map() as any,
      }));

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'sent',
            amount: BigInt(-100_000),
            fee: BigInt(100_000),
          })],
        })
      );
    });

    it('classifies a zero wallet delta with addressless external evidence as sent', async () => {
      const txid = 'zero_delta_external'.padEnd(64, 'a');
      const walletAddress = 'tb1q_zero_delta_wallet';
      const externalAddress = 'tb1q_zero_delta_external';
      const transaction = createMockTransaction({
        txid,
        inputs: [
          {
            txid: 'zero_delta_wallet_prev'.padEnd(64, 'b'),
            vout: 0,
            value: 0.001,
            address: walletAddress,
          },
          {
            txid: 'zero_delta_external_prev'.padEnd(64, 'c'),
            vout: 0,
            value: 0.002,
            address: externalAddress,
          },
        ],
        outputs: [
          { value: 0.001, address: walletAddress },
          { value: 0.0019, address: 'placeholder' },
        ],
      });
      transaction.vout[1].scriptPubKey = { hex: '6a026869' };
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));

      await processTransactionsPhase(createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'zero-delta-external-address' } as any]]),
        txDetailsCache: new Map() as any,
      }));

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'sent',
            amount: BigInt(0),
            fee: BigInt(10_000),
            classificationInputsComplete: true,
          })],
        })
      );
    });

    it('classifies a zero wallet delta without external evidence as consolidation', async () => {
      const txid = 'zero_delta_consolidation'.padEnd(64, 'a');
      const walletAddress = 'tb1q_zero_delta_consolidation';
      const transaction = createMockTransaction({
        txid,
        inputs: [{
          txid: 'zero_delta_consolidation_prev'.padEnd(64, 'b'),
          vout: 0,
          value: 0.001,
          address: walletAddress,
        }],
        outputs: [{ value: 0.001, address: walletAddress }],
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));

      await processTransactionsPhase(createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'zero-delta-consolidation-address' } as any]]),
        txDetailsCache: new Map() as any,
      }));

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            txid,
            type: 'consolidation',
            amount: BigInt(0),
            fee: BigInt(0),
            classificationInputsComplete: true,
          })],
        })
      );
    });

    it('should classify transaction as sent when wallet inputs go to external', async () => {
      const txid = 'sent_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet_addr';
      const externalAddress = 'tb1q_external_addr';
      const changeAddress = 'tb1q_change_addr';

      // Mock transaction: wallet input, external output + change
      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev_tx'.padEnd(64, 'b'), vout: 0, value: 0.01, address: walletAddress }],
        outputs: [
          { value: 0.005, address: externalAddress },
          { value: 0.0049, address: changeAddress },
        ],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress, changeAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'sent',
              // Sent amount is negative: -(external + fee)
            }),
          ]),
        })
      );
    });

    it('should classify transaction as consolidation when all outputs to wallet', async () => {
      const txid = 'consolidation_tx'.padEnd(64, 'a');
      const inputAddr1 = 'tb1q_input1';
      const inputAddr2 = 'tb1q_input2';
      const outputAddr = 'tb1q_output';

      // Mock consolidation: multiple wallet inputs, single wallet output
      const mockTx = createMockTransaction({
        txid,
        inputs: [
          { txid: 'prev_tx1'.padEnd(64, 'b'), vout: 0, value: 0.01, address: inputAddr1 },
          { txid: 'prev_tx2'.padEnd(64, 'c'), vout: 0, value: 0.01, address: inputAddr2 },
        ],
        outputs: [{ value: 0.0199, address: outputAddr }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[inputAddr1, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([inputAddr1, inputAddr2, outputAddr]),
        addressMap: new Map([[inputAddr1, { id: 'addr-1', address: inputAddr1 } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'consolidation',
            }),
          ]),
        })
      );
    });

    it('should set rbfStatus to active for unconfirmed transactions', async () => {
      const txid = 'unconfirmed_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';
      const externalAddress = 'tb1q_external';

      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 0 }]]]), // height 0 = unconfirmed
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              rbfStatus: 'active',
              confirmations: 0,
            }),
          ]),
        })
      );
    });

    it('promotes a transient received row without duplicate creation side effects', async () => {
      const txid = 'repair_received_to_sent'.padEnd(64, 'a');
      const walletAddress = 'tb1q_repair_wallet';
      const externalAddress = 'tb1q_repair_recipient';
      const transaction = createMockTransaction({
        txid,
        inputs: [{
          txid: 'repair_prev'.padEnd(64, 'b'),
          vout: 0,
          value: 0.001,
          address: walletAddress,
        }],
        outputs: [
          { value: 0.0008, address: externalAddress },
          { value: 0.0001, address: walletAddress },
        ],
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, transaction]]));
      mockPrismaClient.transaction.createManyAndReturn.mockResolvedValue([]);
      mockPrismaClient.$queryRaw.mockResolvedValue([{
        id: 'repair-row-id',
        classificationInputsComplete: false,
        classificationVersion: 1,
      }]);
      mockPrismaClient.addressLabel.findMany.mockResolvedValue([
        { addressId: 'addr-repair', labelId: 'label-repair' },
      ]);
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.select?.id && args?.select?.txid && args?.select?.type) {
          return [{ id: 'repair-row-id', txid, type: 'sent' }];
        }
        if (args?.select?.id && args?.select?.txid && args?.select?.addressId) {
          return [{ id: 'repair-row-id', txid, addressId: 'addr-repair' }];
        }
        return [];
      });

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-repair', address: walletAddress } as any]]),
        existingTxMap: new Map([[`${txid}:received`, true]]),
        existingTxidSet: new Set([txid]),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
        where: { id: 'repair-row-id' },
        data: expect.objectContaining({
          type: 'sent',
          rbfStatus: 'confirmed',
          classificationVersion: 2,
        }),
      });
      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalled();
      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalled();
      expect(mockPrismaClient.transactionLabel.createMany).toHaveBeenCalledWith({
        data: [{ transactionId: 'repair-row-id', labelId: 'label-repair' }],
        skipDuplicates: true,
      });
      expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
      expect(notifyNewTransactions).not.toHaveBeenCalled();
      expect(result.newTransactions).toEqual([]);
      expect(result.stats.newTransactionsCreated).toBe(0);
    });

    it('should set rbfStatus to confirmed for confirmed transactions', async () => {
      const txid = 'confirmed_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';
      const externalAddress = 'tb1q_external';

      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: externalAddress }],
        outputs: [{ value: 0.0009, address: walletAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              rbfStatus: 'confirmed',
              confirmations: 101, // 800100 - 800000 + 1
            }),
          ]),
        })
      );
    });

    it('should calculate fee for sent transactions', async () => {
      const txid = 'sent_with_fee'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';
      const externalAddress = 'tb1q_external';

      // Input: 1,000,000 sats, Output: 990,000 sats, Fee: 10,000 sats
      const mockTx = createMockTransaction({
        txid,
        inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.01, address: walletAddress }],
        outputs: [{ value: 0.0099, address: externalAddress }],
      });

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, mockTx]]));

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid,
              type: 'sent',
              fee: BigInt(10000), // 0.01 - 0.0099 = 0.0001 BTC = 10000 sats
            }),
          ]),
        })
      );
    });

    it('should fall back to individual requests when batch fetch fails', async () => {
      const txid = 'fallback_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';

      mockElectrumClient.getTransactionsBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getTransaction.mockResolvedValue(
        createMockTransaction({
          txid,
          inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
          outputs: [{ value: 0.0009, address: walletAddress }],
        })
      );

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      await processTransactionsPhase(ctx);

      expect(mockElectrumClient.getTransaction).toHaveBeenCalledWith(txid, true);
    });

    it('should update stats with processed transaction counts', async () => {
      const txid = 'stats_tx'.padEnd(64, 'a');
      const walletAddress = 'tb1q_wallet';

      mockElectrumClient.getTransactionsBatch.mockResolvedValue(
        new Map([[txid, createMockTransaction({
          txid,
          inputs: [{ txid: 'prev'.padEnd(64, 'b'), vout: 0, value: 0.001, address: 'external' }],
          outputs: [{ value: 0.0009, address: walletAddress }],
        })]])
      );

      const ctx = createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: [txid],
        historyResults: new Map([[walletAddress, [{ tx_hash: txid, height: 800000 }]]]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
        existingTxMap: new Map(),
        txDetailsCache: new Map() as any,
        currentBlockHeight: 800100,
      });

      const result = await processTransactionsPhase(ctx);

      expect(result.stats.transactionsProcessed).toBe(1);
    });
}
