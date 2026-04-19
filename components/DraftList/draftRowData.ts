import type React from 'react';
import { WalletType } from '../../types';
import type { DraftTransaction } from '../../src/api/drafts';

export function getDraftRowClass(expired: boolean): string {
  const borderClass = expired
    ? 'border-rose-300 dark:border-rose-800 opacity-75'
    : 'border-sanctuary-200 dark:border-sanctuary-700';
  return `surface-elevated rounded-lg p-4 border ${borderClass}`;
}

export function getRequiredSignatureCount(quorum?: { m: number; n: number }): number {
  return quorum?.m || 1;
}

export function getSignedDeviceCount(draft: DraftTransaction): number {
  return draft.signedDeviceIds?.length || 0;
}

export function isAgentFundingDraft(draft: DraftTransaction): boolean {
  return Boolean(draft.agentId);
}

export function getAgentSignatureText(draft: DraftTransaction): string {
  return getSignedDeviceCount(draft) > 0 ? 'present' : 'missing';
}

export function canShowSingleSigPsbtControls(walletType: WalletType): boolean {
  return walletType !== WalletType.MULTI_SIG;
}

export function handleDraftPsbtFileSelection(
  event: React.ChangeEvent<HTMLInputElement>,
  draftId: string,
  onUploadPsbt: (draftId: string, file: File) => void
): void {
  const file = event.target.files?.[0];
  if (file) onUploadPsbt(draftId, file);
  event.target.value = '';
}
