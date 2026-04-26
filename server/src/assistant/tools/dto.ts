type RecordLike = Record<string, any>;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function sats(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

function labelsFromTransaction(transaction: RecordLike): string[] {
  return Array.isArray(transaction.transactionLabels)
    ? transaction.transactionLabels
        .map((transactionLabel: RecordLike) => transactionLabel.label?.name)
        .filter((label: unknown): label is string => typeof label === 'string')
    : [];
}

function labelsFromAddress(address: RecordLike): string[] {
  return Array.isArray(address.addressLabels)
    ? address.addressLabels
        .map((addressLabel: RecordLike) => addressLabel.label?.name)
        .filter((label: unknown): label is string => typeof label === 'string')
    : [];
}

export function toWalletDto(wallet: RecordLike) {
  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type,
    scriptType: wallet.scriptType,
    network: wallet.network,
    quorum: wallet.quorum,
    totalSigners: wallet.totalSigners,
    groupId: wallet.groupId,
    groupRole: wallet.groupRole,
    sync: {
      inProgress: wallet.syncInProgress,
      lastSyncedAt: iso(wallet.lastSyncedAt),
      lastSyncedBlockHeight: wallet.lastSyncedBlockHeight,
      lastSyncStatus: wallet.lastSyncStatus,
    },
    createdAt: iso(wallet.createdAt),
    updatedAt: iso(wallet.updatedAt),
  };
}

export function toTransactionDto(transaction: RecordLike) {
  return {
    id: transaction.id,
    txid: transaction.txid,
    walletId: transaction.walletId,
    type: transaction.type,
    amount: sats(transaction.amount),
    fee: sats(transaction.fee),
    balanceAfter: sats(transaction.balanceAfter),
    confirmations: transaction.confirmations,
    blockHeight: transaction.blockHeight,
    blockTime: iso(transaction.blockTime),
    label: transaction.label,
    memo: transaction.memo,
    labels: labelsFromTransaction(transaction),
    counterpartyAddress: transaction.counterpartyAddress,
    rbfStatus: transaction.rbfStatus,
    replacedByTxid: transaction.replacedByTxid,
    replacementForTxid: transaction.replacementForTxid,
    createdAt: iso(transaction.createdAt),
    updatedAt: iso(transaction.updatedAt),
  };
}

export function toUtxoDto(utxo: RecordLike) {
  return {
    id: utxo.id,
    walletId: utxo.walletId,
    txid: utxo.txid,
    vout: utxo.vout,
    address: utxo.address,
    amount: sats(utxo.amount),
    confirmations: utxo.confirmations,
    blockHeight: utxo.blockHeight,
    spent: utxo.spent,
    spentTxid: utxo.spentTxid,
    frozen: utxo.frozen,
    lockedByDraft: utxo.draftLock?.draft
      ? {
          id: utxo.draftLock.draft.id,
          label: utxo.draftLock.draft.label,
        }
      : null,
    createdAt: iso(utxo.createdAt),
    updatedAt: iso(utxo.updatedAt),
  };
}

export function toAddressDto(address: RecordLike) {
  return {
    id: address.id,
    walletId: address.walletId,
    address: address.address,
    index: address.index,
    used: address.used,
    labels: labelsFromAddress(address),
    createdAt: iso(address.createdAt),
  };
}

export function toPolicyDto(policy: RecordLike) {
  return {
    id: policy.id,
    walletId: policy.walletId,
    groupId: policy.groupId,
    name: policy.name,
    description: policy.description,
    type: policy.type,
    config: policy.config,
    priority: policy.priority,
    enforcement: policy.enforcement,
    enabled: policy.enabled,
    sourceType: policy.sourceType,
    sourceId: policy.sourceId,
    createdAt: iso(policy.createdAt),
    updatedAt: iso(policy.updatedAt),
  };
}

function countDraftRecipients(draft: RecordLike): number {
  if (Array.isArray(draft.outputs)) {
    return draft.outputs.length;
  }
  /* v8 ignore next -- legacy draft recipient fallback is retained for older stored records */
  return draft.recipient ? 1 : 0;
}

export function toDraftStatusDto(draft: RecordLike) {
  return {
    id: draft.id,
    walletId: draft.walletId,
    label: draft.label,
    status: draft.status,
    approvalStatus: draft.approvalStatus,
    createdAt: iso(draft.createdAt),
    updatedAt: iso(draft.updatedAt),
    expiresAt: iso(draft.expiresAt),
    totalAmount: sats(draft.totalOutput ?? draft.amount),
    feeAmount: sats(draft.fee),
    recipientCount: countDraftRecipients(draft),
  };
}
