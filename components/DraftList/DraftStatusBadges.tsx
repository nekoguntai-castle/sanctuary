import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import type { DraftTransaction } from '../../src/api/drafts';
import type { ExpirationInfo } from './types';
import {
  getRequiredSignatureCount,
  getSignedDeviceCount,
  isAgentFundingDraft,
} from './draftRowData';

interface DraftStatusBadgesProps {
  draft: DraftTransaction;
  quorum?: { m: number; n: number };
  expirationInfo: ExpirationInfo | null;
}

const statusBadgeBase = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium';

function DraftStatusBadge({
  draft,
  quorum,
}: Pick<DraftStatusBadgesProps, 'draft' | 'quorum'>) {
  if (draft.status === 'unsigned') {
    return (
      <span className={`${statusBadgeBase} bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400`}>
        <Clock className="w-3 h-3" />
        Unsigned
      </span>
    );
  }

  if (draft.status === 'partial') {
    return (
      <span className={`${statusBadgeBase} bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400`}>
        <AlertTriangle className="w-3 h-3" />
        {getSignedDeviceCount(draft)} of {getRequiredSignatureCount(quorum)} signed
      </span>
    );
  }

  if (draft.status === 'signed') {
    return (
      <span className={`${statusBadgeBase} bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400`}>
        <CheckCircle2 className="w-3 h-3" />
        Ready to broadcast
      </span>
    );
  }

  return null;
}

function DraftExpirationBadge({ expirationInfo }: { expirationInfo: ExpirationInfo | null }) {
  if (!expirationInfo) return null;

  if (expirationInfo.urgency === 'expired') {
    return (
      <span className={`${statusBadgeBase} bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400`}>
        <AlertCircle className="w-3 h-3" />
        {expirationInfo.text}
      </span>
    );
  }

  if (expirationInfo.urgency === 'critical') {
    return (
      <span className={`${statusBadgeBase} bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800`}>
        <AlertCircle className="w-3 h-3" />
        {expirationInfo.text}
      </span>
    );
  }

  if (expirationInfo.urgency === 'warning') {
    return (
      <span className={`${statusBadgeBase} bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800`}>
        <AlertTriangle className="w-3 h-3" />
        {expirationInfo.text}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-sanctuary-400 dark:text-sanctuary-500">
      <Clock className="w-3 h-3" />
      {expirationInfo.text}
    </span>
  );
}

function AgentFundingBadge() {
  return (
    <span className={`${statusBadgeBase} bg-shared-100 text-shared-800 dark:bg-shared-100 dark:text-shared-700`}>
      <Bot className="w-3 h-3" />
      Agent funding request
    </span>
  );
}

export const DraftStatusBadges: React.FC<DraftStatusBadgesProps> = ({
  draft,
  quorum,
  expirationInfo,
}) => (
  <>
    <DraftStatusBadge draft={draft} quorum={quorum} />
    <DraftExpirationBadge expirationInfo={expirationInfo} />
    {isAgentFundingDraft(draft) && <AgentFundingBadge />}
  </>
);
