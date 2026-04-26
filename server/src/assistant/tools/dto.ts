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

function toTransactionInputDto(input: RecordLike) {
  return {
    id: input.id,
    inputIndex: input.inputIndex,
    txid: input.txid,
    vout: input.vout,
    address: input.address,
    amount: sats(input.amount),
    derivationPath: input.derivationPath,
  };
}

function toTransactionOutputDto(output: RecordLike) {
  return {
    id: output.id,
    outputIndex: output.outputIndex,
    address: output.address,
    amount: sats(output.amount),
    scriptPubKey: output.scriptPubKey,
    outputType: output.outputType,
    isOurs: output.isOurs,
    label: output.label,
  };
}

export function toTransactionDetailDto(transaction: RecordLike) {
  return {
    ...toTransactionDto(transaction),
    wallet: transaction.wallet
      ? {
          id: transaction.wallet.id,
          name: transaction.wallet.name,
          type: transaction.wallet.type,
          network: transaction.wallet.network,
        }
      : null,
    address: transaction.address
      ? {
          id: transaction.address.id,
          address: transaction.address.address,
          derivationPath: transaction.address.derivationPath,
          index: transaction.address.index,
          used: transaction.address.used,
        }
      : null,
    inputs: Array.isArray(transaction.inputs) ? transaction.inputs.map(toTransactionInputDto) : [],
    outputs: Array.isArray(transaction.outputs) ? transaction.outputs.map(toTransactionOutputDto) : [],
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

function isChangeAddress(address: RecordLike): boolean {
  // BIP44-style derivation paths end with /change/index, where change branch 1 is internal/change.
  const path = typeof address.derivationPath === 'string' ? address.derivationPath : '';
  const parts = path.split('/');
  return parts.length >= 2 && parts[parts.length - 2] === '1';
}

export function toAddressDetailDto(input: { address: RecordLike; balance: RecordLike }) {
  return {
    ...toAddressDto(input.address),
    derivationPath: input.address.derivationPath,
    isChange: isChangeAddress(input.address),
    transactionCount: input.address._count?.transactions ?? 0,
    balance: {
      unspentSats: sats(input.balance._sum?.amount) ?? '0',
      unspentUtxoCount: input.balance._count?.id ?? 0,
    },
  };
}

export function toWalletDeviceSummaryDto(walletDevice: RecordLike) {
  return {
    id: walletDevice.id,
    signerIndex: walletDevice.signerIndex,
    device: walletDevice.device
      ? {
          id: walletDevice.device.id,
          type: walletDevice.device.type,
          modelName: walletDevice.device.model?.name ?? null,
          manufacturer: walletDevice.device.model?.manufacturer ?? null,
        }
      : null,
    createdAt: iso(walletDevice.createdAt),
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
