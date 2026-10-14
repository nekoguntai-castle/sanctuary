import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from 'lucide-react';
import type { DraftTransaction } from '../../api/drafts';
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

// Mirrors the broadcast allow-list (api/transactions/broadcasting.ts): a draft whose approval
// is pending, rejected, vetoed or expired is refused at broadcast, so it is not "ready".
const BROADCAST_APPROVAL_STATUSES = new Set(['not_required', 'approved']);

// Drafts from older servers carry no approvalStatus; they predate approval workflows.
const isBroadcastAllowed = (draft: DraftTransaction): boolean =>
  BROADCAST_APPROVAL_STATUSES.has(draft.approvalStatus ?? 'not_required');

const APPROVAL_BADGES: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
  pending: { label: 'Awaiting approval', className: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30', Icon: ShieldAlert },
  approved: { label: 'Approved', className: 'bg-success-100 text-success-700 dark:bg-success-900/30', Icon: ShieldCheck },
  rejected: { label: 'Approval rejected', className: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400', Icon: ShieldX },
  vetoed: { label: 'Approval vetoed', className: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400', Icon: ShieldX },
  expired: { label: 'Approval expired', className: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400', Icon: ShieldX },
};

function DraftApprovalBadge({ draft }: { draft: DraftTransaction }) {
  const badge = draft.approvalStatus ? APPROVAL_BADGES[draft.approvalStatus] : undefined;
  if (!badge) return null;

  return (
    <span className={`${statusBadgeBase} ${badge.className}`}>
      <badge.Icon className="w-3 h-3" />
      {badge.label}
    </span>
  );
}

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
      <span className={`${statusBadgeBase} bg-warning-100 text-warning-700 dark:bg-warning-900/30`}>
        <AlertTriangle className="w-3 h-3" />
        {getSignedDeviceCount(draft)} of {getRequiredSignatureCount(quorum)} signed
      </span>
    );
  }

  if (draft.status === 'signed' && isBroadcastAllowed(draft)) {
    return (
      <span className={`${statusBadgeBase} bg-success-100 text-success-700 dark:bg-success-900/30`}>
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
    <DraftApprovalBadge draft={draft} />
    <DraftExpirationBadge expirationInfo={expirationInfo} />
    {isAgentFundingDraft(draft) && <AgentFundingBadge />}
  </>
);
