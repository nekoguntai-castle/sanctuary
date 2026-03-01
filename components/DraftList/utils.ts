/**
 * DraftList Utility Functions
 *
 * Helper functions for expiration calculation, fee warnings, and flow preview data.
 */
import { DraftTransaction } from '../../src/api/drafts';
import { FlowInput, FlowOutput } from '../TransactionFlowPreview';
import { ExpirationInfo, FeeWarning, FlowPreviewData } from './types';

/**
 * Calculate expiration info for a draft
 */
export const getExpirationInfo = (expiresAt: string | undefined): ExpirationInfo | null => {
  if (!expiresAt) return null;

  const expDate = new Date(expiresAt);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { text: 'Expired', urgency: 'expired', diffMs };
  }

  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 60) {
    return { text: `Expires in ${diffMin}m`, urgency: 'critical', diffMs };
  }
  if (diffHour < 24) {
    return { text: `Expires in ${diffHour}h`, urgency: 'critical', diffMs };
  }
  if (diffHour < 48) {
    return { text: 'Expires tomorrow', urgency: 'warning', diffMs };
  }
  if (diffDay <= 2) {
    return { text: `Expires in ${diffDay} days`, urgency: 'warning', diffMs };
  }
  return { text: `Expires in ${diffDay} days`, urgency: 'normal', diffMs };
};

/**
 * Calculate fee warning for a draft
 */
export const getFeeWarning = (draft: DraftTransaction): FeeWarning | null => {
  const fee = draft.fee;
  const sendAmount = draft.effectiveAmount;

  if (sendAmount <= 0 || fee <= 0) return null;

  const feePercent = (fee / sendAmount) * 100;

  if (feePercent >= 50) {
    return { level: 'critical', percent: feePercent, message: 'Fee is more than half of the amount!' };
  } else if (feePercent >= 25) {
    return { level: 'critical', percent: feePercent, message: 'Fee is more than 25% of the amount' };
  } else if (feePercent >= 10) {
    return { level: 'warning', percent: feePercent, message: 'Fee is more than 10% of the amount' };
  }
  return null;
};

/**
 * Build flow preview data from draft
 */
export const getFlowPreviewData = (
  draft: DraftTransaction,
  getAddressLabel: (address: string) => string | undefined,
): FlowPreviewData => {
  // Use individual inputs if available, otherwise create a summary input
  let inputs: FlowInput[];
  if (draft.inputs && draft.inputs.length > 0) {
    inputs = draft.inputs.map(input => ({
      txid: input.txid,
      vout: input.vout,
      address: input.address,
      amount: input.amount,
      label: getAddressLabel(input.address),
    }));
  } else {
    // Fallback: create a summary input
    inputs = [{
      txid: 'inputs',
      vout: 0,
      address: `${draft.selectedUtxoIds?.length || 1} input${(draft.selectedUtxoIds?.length || 1) !== 1 ? 's' : ''}`,
      amount: draft.totalInput,
    }];
  }

  // Build outputs from draft data
  const flowOutputs: FlowOutput[] = [];

  if (draft.outputs && draft.outputs.length > 0) {
    draft.outputs.forEach((output) => {
      flowOutputs.push({
        address: output.address,
        amount: output.sendMax ? draft.effectiveAmount : output.amount,
        isChange: false,
        label: getAddressLabel(output.address),
      });
    });
  } else {
    // Fallback to single recipient
    flowOutputs.push({
      address: draft.recipient,
      amount: draft.effectiveAmount,
      isChange: false,
      label: getAddressLabel(draft.recipient),
    });
  }

  // Add decoy outputs if present (these are change outputs distributed for privacy)
  // Or add single change output if no decoys
  if (draft.decoyOutputs && draft.decoyOutputs.length > 0) {
    draft.decoyOutputs.forEach(decoy => {
      flowOutputs.push({
        address: decoy.address,
        amount: decoy.amount,
        isChange: true,
        label: getAddressLabel(decoy.address),
      });
    });
  } else if (draft.changeAmount > 0 && draft.changeAddress) {
    flowOutputs.push({
      address: draft.changeAddress,
      amount: draft.changeAmount,
      isChange: true,
      label: getAddressLabel(draft.changeAddress),
    });
  }

  return {
    inputs,
    outputs: flowOutputs,
    fee: draft.fee,
    feeRate: draft.feeRate,
    totalInput: draft.totalInput,
    totalOutput: draft.totalOutput,
  };
};

/**
 * Check if a draft is expired
 */
export const isExpired = (draft: DraftTransaction): boolean => {
  const expInfo = getExpirationInfo(draft.expiresAt);
  return expInfo?.urgency === 'expired';
};

/**
 * Format a date string for display
 */
export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};
