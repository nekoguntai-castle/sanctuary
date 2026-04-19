import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DraftTransaction } from '../../src/api/drafts';
import type { FeeWarning } from './types';
import {
  getAgentSignatureText,
  isAgentFundingDraft,
} from './draftRowData';

interface DraftFeeWarningBannerProps {
  feeWarning: FeeWarning | null;
}

export const DraftFeeWarningBanner: React.FC<DraftFeeWarningBannerProps> = ({
  feeWarning,
}) => {
  if (!feeWarning) return null;

  const isCritical = feeWarning.level === 'critical';

  return (
    <div className={`mt-2 p-2 rounded-lg border flex items-center gap-2 ${
      isCritical
        ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800'
        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    }`}>
      <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${
        isCritical ? 'text-rose-500' : 'text-amber-500'
      }`} />
      <span className={`text-sm ${
        isCritical ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'
      }`}>
        {feeWarning.message} ({feeWarning.percent.toFixed(1)}%)
      </span>
    </div>
  );
};

export const DraftLabel: React.FC<{ label?: string }> = ({ label }) => {
  if (!label) return null;

  return (
    <div className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
      Label: {label}
    </div>
  );
};

export const DraftAgentSignature: React.FC<{ draft: DraftTransaction }> = ({ draft }) => {
  if (!isAgentFundingDraft(draft)) return null;

  return (
    <div className="mt-2 text-sm text-sanctuary-600 dark:text-sanctuary-300">
      Agent signature: {getAgentSignatureText(draft)}
    </div>
  );
};

export const DraftAgentFundingNotice: React.FC<{ draft: DraftTransaction }> = ({ draft }) => {
  if (!isAgentFundingDraft(draft)) return null;

  return (
    <div className="mt-2 p-2 rounded-lg border flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500 mt-0.5" />
      <span className="text-sm text-amber-700 dark:text-amber-300">
        Once funded, the agent can spend from the operational wallet without multisig approval.
      </span>
    </div>
  );
};
