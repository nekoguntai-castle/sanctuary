import { describe, expect, it } from 'vitest';
import {
  toAddressDetailDto,
  toAddressDto,
  toDraftStatusDto,
  toPolicyDto,
  toTransactionDetailDto,
  toTransactionDto,
  toUtxoDto,
  toWalletDeviceSummaryDto,
  toWalletDto,
} from '../../../src/assistant/tools/dto';

describe('assistant read-tool DTO redaction helpers', () => {
  it('maps wallet and policy records without exposing non-display internals', () => {
    expect(toWalletDto({
      id: 'wallet-1',
      name: 'Treasury',
      type: 'multisig',
      scriptType: 'p2wsh',
      network: 'mainnet',
      quorum: 2,
      totalSigners: 3,
      groupId: null,
      groupRole: null,
      syncInProgress: false,
      lastSyncedAt: null,
      lastSyncedBlockHeight: 840000,
      lastSyncStatus: 'ok',
      createdAt: new Date('2026-04-26T00:00:00.000Z'),
      updatedAt: '2026-04-26T01:00:00.000Z',
    })).toMatchObject({
      id: 'wallet-1',
      sync: { inProgress: false, lastSyncedAt: null },
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T01:00:00.000Z',
    });

    expect(toPolicyDto({
      id: 'policy-1',
      walletId: 'wallet-1',
      groupId: null,
      name: 'Large spend',
      description: null,
      type: 'spending_limit',
      config: { amount: '100000' },
      priority: 1,
      enforcement: 'approval_required',
      enabled: true,
      sourceType: 'manual',
      sourceId: null,
      createdAt: null,
      updatedAt: new Date('2026-04-26T00:00:00.000Z'),
    })).toMatchObject({
      id: 'policy-1',
      config: { amount: '100000' },
      createdAt: null,
      updatedAt: '2026-04-26T00:00:00.000Z',
    });
  });

  it('maps transaction labels and nullable satoshi/date fields', () => {
    expect(toTransactionDto({
      id: 'tx-1',
      txid: 'abc',
      walletId: 'wallet-1',
      type: 'received',
      amount: 1000n,
      fee: null,
      balanceAfter: '2000',
      confirmations: 3,
      blockHeight: 840000,
      blockTime: '2026-04-26T00:00:00.000Z',
      label: null,
      memo: null,
      transactionLabels: [{ label: { name: 'income' } }, { label: {} }],
      counterpartyAddress: null,
      rbfStatus: null,
      replacedByTxid: null,
      replacementForTxid: null,
      createdAt: null,
      updatedAt: new Date('2026-04-26T01:00:00.000Z'),
    })).toMatchObject({
      amount: '1000',
      fee: null,
      balanceAfter: '2000',
      labels: ['income'],
      blockTime: '2026-04-26T00:00:00.000Z',
      createdAt: null,
    });

    expect(toTransactionDto({ transactionLabels: null }).labels).toEqual([]);
  });

  it('maps transaction details with optional wallet, address, input, and output relationships', () => {
    expect(toTransactionDetailDto({
      id: 'tx-1',
      txid: 'abc',
      walletId: 'wallet-1',
      type: 'received',
      amount: 1000n,
      fee: 0n,
      balanceAfter: 1000n,
      confirmations: 1,
      blockHeight: 840000,
      blockTime: null,
      transactionLabels: [],
      wallet: { id: 'wallet-1', name: 'Treasury', type: 'multi_sig', network: 'mainnet' },
      address: { id: 'addr-1', address: 'bc1qsource', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: true },
      inputs: [{ id: 'input-1', inputIndex: 0, txid: 'prev', vout: 1, address: 'bc1qsource', amount: 1500n }],
      outputs: [{ id: 'output-1', outputIndex: 0, address: 'bc1qdest', amount: 1000n, outputType: 'recipient', isOurs: false }],
    })).toMatchObject({
      wallet: { id: 'wallet-1', network: 'mainnet' },
      address: { id: 'addr-1', index: 0 },
      inputs: [{ amount: '1500' }],
      outputs: [{ amount: '1000', outputType: 'recipient' }],
    });

    expect(toTransactionDetailDto({
      transactionLabels: null,
      wallet: null,
      address: null,
      inputs: null,
      outputs: null,
    })).toMatchObject({
      wallet: null,
      address: null,
      inputs: [],
      outputs: [],
    });
  });

  it('maps UTXOs and addresses with labels and draft-lock redaction metadata', () => {
    expect(toUtxoDto({
      id: 'utxo-1',
      walletId: 'wallet-1',
      txid: 'abc',
      vout: 0,
      address: 'bc1qexample',
      amount: 5000,
      confirmations: 2,
      blockHeight: 840000,
      spent: false,
      spentTxid: null,
      frozen: true,
      draftLock: { draft: { id: 'draft-1', label: 'rebalance' } },
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: null,
    })).toMatchObject({
      amount: '5000',
      frozen: true,
      lockedByDraft: { id: 'draft-1', label: 'rebalance' },
      updatedAt: null,
    });

    expect(toUtxoDto({ draftLock: null }).lockedByDraft).toBeNull();
    expect(toAddressDto({
      id: 'addr-1',
      walletId: 'wallet-1',
      address: 'bc1qexample',
      index: 7,
      used: true,
      addressLabels: [{ label: { name: 'deposit' } }, { label: null }],
      createdAt: new Date('2026-04-26T00:00:00.000Z'),
    })).toMatchObject({
      labels: ['deposit'],
      createdAt: '2026-04-26T00:00:00.000Z',
    });
    expect(toAddressDto({ addressLabels: null }).labels).toEqual([]);
  });

  it('maps address details and wallet devices with relationship defaults', () => {
    expect(toAddressDetailDto({
      address: {
        id: 'addr-1',
        walletId: 'wallet-1',
        address: 'bc1qchange',
        derivationPath: "m/84'/0'/0'/1/7",
        index: 7,
        used: true,
        addressLabels: [{ label: { name: 'change' } }],
        _count: { transactions: 2 },
        createdAt: null,
      },
      balance: { _count: { id: 1 }, _sum: { amount: 500n } },
    })).toMatchObject({
      labels: ['change'],
      isChange: true,
      transactionCount: 2,
      balance: { unspentSats: '500', unspentUtxoCount: 1 },
    });

    expect(toAddressDetailDto({
      address: {
        id: 'addr-2',
        walletId: 'wallet-1',
        address: 'bc1qreceive',
        derivationPath: null,
        index: 8,
        used: false,
        addressLabels: null,
        _count: {},
      },
      balance: { _count: {}, _sum: {} },
    })).toMatchObject({
      labels: [],
      isChange: false,
      transactionCount: 0,
      balance: { unspentSats: '0', unspentUtxoCount: 0 },
    });

    expect(toWalletDeviceSummaryDto({
      id: 'wallet-device-1',
      signerIndex: 0,
      device: { id: 'device-1', type: 'coldcard', model: null },
      createdAt: '2026-04-26T00:00:00.000Z',
    })).toEqual({
      id: 'wallet-device-1',
      signerIndex: 0,
      device: { id: 'device-1', type: 'coldcard', modelName: null, manufacturer: null },
      createdAt: '2026-04-26T00:00:00.000Z',
    });

    expect(toWalletDeviceSummaryDto({
      id: 'wallet-device-2',
      signerIndex: 1,
      device: null,
      createdAt: null,
    })).toMatchObject({ device: null, createdAt: null });
  });

  it('maps draft status without PSBT material', () => {
    expect(toDraftStatusDto({
      id: 'draft-1',
      walletId: 'wallet-1',
      label: 'payment',
      status: 'pending',
      approvalStatus: 'pending',
      createdAt: new Date('2026-04-26T00:00:00.000Z'),
      updatedAt: null,
      expiresAt: '2026-04-27T00:00:00.000Z',
      totalOutput: 7000n,
      amount: 9999n,
      fee: 10n,
      outputs: [{ address: 'bc1qone' }, { address: 'bc1qtwo' }],
      psbt: 'must-not-leak',
    })).toEqual({
      id: 'draft-1',
      walletId: 'wallet-1',
      label: 'payment',
      status: 'pending',
      approvalStatus: 'pending',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: null,
      expiresAt: '2026-04-27T00:00:00.000Z',
      totalAmount: '7000',
      feeAmount: '10',
      recipientCount: 2,
    });

    expect(toDraftStatusDto({ amount: 3000n, fee: null, recipient: 'bc1qone' })).toMatchObject({
      totalAmount: '3000',
      feeAmount: null,
      recipientCount: 1,
    });
  });
});
