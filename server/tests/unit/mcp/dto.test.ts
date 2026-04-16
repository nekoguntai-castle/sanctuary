import { describe, expect, it } from 'vitest';

import {
  toAddressDto,
  toAuditLogDto,
  toDraftStatusDto,
  toInsightDto,
  toLabelDto,
  toMcpApiKeyMetadata,
  toPolicyDto,
  toTransactionDetailDto,
  toTransactionDto,
  toUtxoDto,
  toWalletDto,
} from '../../../src/mcp/dto';

describe('MCP DTO helpers', () => {
  const now = new Date('2026-04-16T00:00:00.000Z');

  it('maps wallet sync metadata', () => {
    expect(toWalletDto({
      id: 'wallet-1',
      name: 'Treasury',
      type: 'multisig',
      scriptType: 'p2wsh',
      network: 'mainnet',
      quorum: 2,
      totalSigners: 3,
      groupId: 'group-1',
      groupRole: 'admin',
      syncInProgress: false,
      lastSyncedAt: now,
      lastSyncedBlockHeight: 840000,
      lastSyncStatus: 'success',
      createdAt: now,
      updatedAt: now.toISOString(),
    })).toMatchObject({
      id: 'wallet-1',
      sync: {
        inProgress: false,
        lastSyncedAt: now.toISOString(),
        lastSyncedBlockHeight: 840000,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it('maps transactions and details with labels and sats as strings', () => {
    const base = {
      id: 'tx-1',
      txid: 'txid',
      walletId: 'wallet-1',
      type: 'received',
      amount: BigInt(123),
      fee: 4,
      balanceAfter: '127',
      confirmations: 2,
      blockHeight: 840001,
      blockTime: now,
      transactionLabels: [{ label: { name: 'payroll' } }, { label: { name: 123 } }],
      createdAt: now,
      updatedAt: now,
    };

    expect(toTransactionDto(base)).toMatchObject({
      amount: '123',
      fee: '4',
      balanceAfter: '127',
      labels: ['payroll'],
      blockTime: now.toISOString(),
    });
    expect(toTransactionDto({ ...base, transactionLabels: undefined }).labels).toEqual([]);
    expect(toTransactionDetailDto({
      ...base,
      inputs: [{ inputIndex: 0, txid: 'prev', vout: 1, address: 'bc1in', amount: BigInt(5) }],
      outputs: [{ outputIndex: 0, address: 'bc1out', amount: BigInt(6), outputType: 'p2wpkh', isOurs: true }],
    })).toMatchObject({
      inputs: [{ amount: '5' }],
      outputs: [{ amount: '6', isOurs: true }],
    });
    expect(toTransactionDetailDto({ ...base, inputs: undefined, outputs: undefined })).toMatchObject({
      inputs: [],
      outputs: [],
    });
  });

  it('maps UTXOs, addresses, labels, policies, insights, drafts, and audit logs', () => {
    expect(toUtxoDto({
      id: 'utxo-1',
      walletId: 'wallet-1',
      txid: 'txid',
      vout: 0,
      address: 'bc1',
      amount: BigInt(1000),
      confirmations: 1,
      spent: false,
      frozen: true,
      draftLock: { draft: { id: 'draft-1', label: 'pay' } },
      createdAt: now,
      updatedAt: now,
    })).toMatchObject({ amount: '1000', lockedByDraft: { id: 'draft-1', label: 'pay' } });
    expect(toUtxoDto({ amount: null, draftLock: null }).lockedByDraft).toBeNull();

    expect(toAddressDto({
      id: 'address-1',
      walletId: 'wallet-1',
      address: 'bc1',
      index: 1,
      used: true,
      addressLabels: [{ label: { name: 'cold' } }, { label: null }],
      createdAt: now,
    })).toMatchObject({ labels: ['cold'], createdAt: now.toISOString() });
    expect(toAddressDto({ addressLabels: undefined }).labels).toEqual([]);

    expect(toLabelDto({ id: 'label-1', name: 'Ops', createdAt: now, updatedAt: now })).toMatchObject({
      id: 'label-1',
      createdAt: now.toISOString(),
    });
    expect(toPolicyDto({ id: 'policy-1', config: { threshold: 2 }, createdAt: now, updatedAt: now })).toMatchObject({
      id: 'policy-1',
      config: { threshold: 2 },
    });
    expect(toInsightDto({ id: 'insight-1', expiresAt: now, createdAt: now, updatedAt: now })).toMatchObject({
      expiresAt: now.toISOString(),
    });
    expect(toDraftStatusDto({
      id: 'draft-1',
      walletId: 'wallet-1',
      outputs: [{}, {}],
      totalOutput: BigInt(55),
      fee: BigInt(2),
      createdAt: now,
      updatedAt: now,
      expiresAt: now,
    })).toMatchObject({ recipientCount: 2, totalAmount: '55', feeAmount: '2' });
    expect(toDraftStatusDto({ recipient: 'bc1', amount: 9 }).recipientCount).toBe(1);

    expect(toAuditLogDto({
      id: 'audit-1',
      userId: 'user-1',
      username: 'alice',
      createdAt: now,
      success: true,
    })).toMatchObject({ id: 'audit-1', createdAt: now.toISOString(), success: true });
  });

  it('maps MCP API key metadata without exposing key hashes', () => {
    expect(toMcpApiKeyMetadata({
      id: 'key-1',
      userId: 'user-1',
      user: { id: 'user-1', username: 'alice', isAdmin: false },
      name: 'Local',
      keyPrefix: 'mcp_abc',
      scope: { walletIds: ['wallet-1'] },
      lastUsedAt: now,
      createdAt: now,
      expiresAt: null,
      revokedAt: null,
      keyHash: 'secret',
    })).toEqual(expect.objectContaining({
      id: 'key-1',
      user: { id: 'user-1', username: 'alice', isAdmin: false },
      keyPrefix: 'mcp_abc',
      lastUsedAt: now.toISOString(),
      expiresAt: null,
    }));
    expect(toMcpApiKeyMetadata({ id: 'key-2', user: undefined }).user).toBeUndefined();
  });
});
