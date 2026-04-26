type RecordLike = Record<string, any>;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function sats(value: bigint | number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

function countDraftRecipients(draft: RecordLike): number {
  if (Array.isArray(draft.outputs)) {
    return draft.outputs.length;
  }
  return draft.recipient ? 1 : 0;
}

function toDraftStatusFields(draft: RecordLike) {
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

export function toLabelSummaryDto(label: RecordLike) {
  return {
    id: label.id,
    walletId: label.walletId,
    name: label.name,
    color: label.color,
    description: label.description,
    transactionCount: label.transactionCount ?? label._count?.transactionLabels ?? 0,
    addressCount: label.addressCount ?? label._count?.addressLabels ?? 0,
    createdAt: iso(label.createdAt),
    updatedAt: iso(label.updatedAt),
  };
}

export function toLabelDetailDto(label: RecordLike) {
  return {
    ...toLabelSummaryDto(label),
    transactions: Array.isArray(label.transactionLabels)
      ? label.transactionLabels.map((item: RecordLike) => ({
          id: item.transaction.id,
          txid: item.transaction.txid,
          type: item.transaction.type,
          amount: sats(item.transaction.amount),
          confirmations: item.transaction.confirmations,
          blockTime: iso(item.transaction.blockTime),
          createdAt: iso(item.transaction.createdAt),
        }))
      : [],
    addresses: Array.isArray(label.addressLabels)
      ? label.addressLabels.map((item: RecordLike) => ({
          id: item.address.id,
          address: item.address.address,
          index: item.address.index,
          used: item.address.used,
          createdAt: iso(item.address.createdAt),
        }))
      : [],
  };
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function objectConfig(config: unknown): RecordLike {
  return config && typeof config === 'object' && !Array.isArray(config)
    ? config as RecordLike
    : {};
}

function summarizePolicyConfig(type: string, rawConfig: unknown) {
  const config = objectConfig(rawConfig);
  switch (type) {
    case 'spending_limit':
      return {
        scope: config.scope,
        perTransaction: config.perTransaction,
        daily: config.daily,
        weekly: config.weekly,
        monthly: config.monthly,
        exemptRoleCount: arrayCount(config.exemptRoles),
      };
    case 'approval_required':
      return {
        trigger: config.trigger ?? null,
        requiredApprovals: config.requiredApprovals,
        quorumType: config.quorumType,
        allowSelfApproval: config.allowSelfApproval,
        expirationHours: config.expirationHours,
        specificApproverCount: arrayCount(config.specificApprovers),
      };
    case 'time_delay':
      return {
        trigger: config.trigger ?? null,
        delayHours: config.delayHours,
        vetoEligible: config.vetoEligible,
        notifyOnStart: config.notifyOnStart,
        notifyOnVeto: config.notifyOnVeto,
        notifyOnClear: config.notifyOnClear,
        specificVetoerCount: arrayCount(config.specificVetoers),
      };
    case 'address_control':
      return {
        mode: config.mode,
        allowSelfSend: config.allowSelfSend,
        managedBy: config.managedBy,
      };
    case 'velocity':
      return {
        scope: config.scope,
        maxPerHour: config.maxPerHour,
        maxPerDay: config.maxPerDay,
        maxPerWeek: config.maxPerWeek,
        exemptRoleCount: arrayCount(config.exemptRoles),
      };
    default:
      return { redacted: true };
  }
}

export function toPolicySummaryDto(policy: RecordLike) {
  return {
    id: policy.id,
    walletId: policy.walletId,
    groupId: policy.groupId,
    name: policy.name,
    description: policy.description,
    type: policy.type,
    config: summarizePolicyConfig(policy.type, policy.config),
    priority: policy.priority,
    enforcement: policy.enforcement,
    enabled: policy.enabled,
    sourceType: policy.sourceType,
    sourceId: policy.sourceId,
    createdAt: iso(policy.createdAt),
    updatedAt: iso(policy.updatedAt),
  };
}

export function toPolicyAddressDto(address: RecordLike) {
  return {
    id: address.id,
    policyId: address.policyId,
    address: address.address,
    label: address.label,
    listType: address.listType,
    createdAt: iso(address.createdAt),
  };
}

export function toPolicyEventDto(event: RecordLike) {
  return {
    id: event.id,
    policyId: event.policyId,
    walletId: event.walletId,
    draftTransactionId: event.draftTransactionId,
    eventType: event.eventType,
    detailKeys: Object.keys(objectConfig(event.details)).sort(),
    createdAt: iso(event.createdAt),
  };
}

export function toDraftDetailDto(draft: RecordLike) {
  const approvalRequests = Array.isArray(draft.approvalRequests) ? draft.approvalRequests : [];
  const utxoLocks = Array.isArray(draft.utxoLocks) ? draft.utxoLocks : [];
  return {
    ...toDraftStatusFields(draft),
    amount: sats(draft.amount),
    feeRate: draft.feeRate,
    fee: sats(draft.fee),
    totalInput: sats(draft.totalInput),
    totalOutput: sats(draft.totalOutput),
    changeAmount: sats(draft.changeAmount),
    effectiveAmount: sats(draft.effectiveAmount),
    recipient: draft.recipient,
    changeAddress: draft.changeAddress,
    enableRBF: draft.enableRBF,
    subtractFees: draft.subtractFees,
    sendMax: draft.sendMax,
    isRBF: draft.isRBF,
    hasPayjoinUrl: Boolean(draft.payjoinUrl),
    signedDeviceCount: arrayCount(draft.signedDeviceIds),
    selectedUtxoCount: arrayCount(draft.selectedUtxoIds),
    lockedUtxoCount: utxoLocks.length,
    approvalRequests: approvalRequests.map((request: RecordLike) => ({
      id: request.id,
      policyId: request.policyId,
      status: request.status,
      requiredApprovals: request.requiredApprovals,
      quorumType: request.quorumType,
      allowSelfApproval: request.allowSelfApproval,
      voteCount: arrayCount(request.votes),
      expiresAt: iso(request.expiresAt),
      resolvedAt: iso(request.resolvedAt),
      createdAt: iso(request.createdAt),
    })),
  };
}

export function toInsightSummaryDto(insight: RecordLike) {
  return {
    id: insight.id,
    walletId: insight.walletId,
    type: insight.type,
    severity: insight.severity,
    title: insight.title,
    summary: insight.summary,
    status: insight.status,
    expiresAt: iso(insight.expiresAt),
    notifiedAt: iso(insight.notifiedAt),
    createdAt: iso(insight.createdAt),
    updatedAt: iso(insight.updatedAt),
  };
}

export function toInsightDetailDto(insight: RecordLike) {
  return {
    ...toInsightSummaryDto(insight),
    analysis: insight.analysis,
  };
}
