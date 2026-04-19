import React from 'react';
import { DraftRowProps } from './types';
import {
  getExpirationInfo,
  getFeeWarning,
  getFlowPreviewData,
  isExpired,
  formatDate,
} from './utils';
import { DraftStatusBadges } from './DraftStatusBadges';
import { DraftRecipientSummary } from './DraftRecipientSummary';
import { DraftAmountSummary } from './DraftAmountSummary';
import {
  DraftAgentFundingNotice,
  DraftAgentSignature,
  DraftFeeWarningBanner,
  DraftLabel,
} from './DraftWarnings';
import { DraftRowActions } from './DraftRowActions';
import { DraftFlowToggle } from './DraftFlowToggle';
import {
  getDraftRowClass,
} from './draftRowData';

export const DraftRow: React.FC<DraftRowProps> = ({
  draft,
  walletType,
  quorum,
  canEdit,
  isExpanded,
  deleteConfirm,
  format,
  getAddressLabel,
  onResume,
  onDelete,
  onDownloadPsbt,
  onUploadPsbt,
  onToggleExpand,
  onSetDeleteConfirm,
}) => {
  const flowData = getFlowPreviewData(draft, getAddressLabel);
  const feeWarning = getFeeWarning(draft);
  const expired = isExpired(draft);
  const expirationInfo = getExpirationInfo(draft.expiresAt);

  return (
    <div className={getDraftRowClass(expired)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2 text-xs text-sanctuary-400">
            <span className="text-xs text-sanctuary-400">
              {formatDate(draft.createdAt)}
            </span>
            <DraftStatusBadges
              draft={draft}
              quorum={quorum}
              expirationInfo={expirationInfo}
            />
          </div>

          <DraftRecipientSummary draft={draft} format={format} />
          <DraftAmountSummary draft={draft} />
          <DraftAgentSignature draft={draft} />
          <DraftFeeWarningBanner feeWarning={feeWarning} />
          <DraftLabel label={draft.label} />
          <DraftAgentFundingNotice draft={draft} />
        </div>

        <DraftRowActions
          draft={draft}
          walletType={walletType}
          canEdit={canEdit}
          expired={expired}
          deleteConfirm={deleteConfirm}
          onResume={onResume}
          onDelete={onDelete}
          onDownloadPsbt={onDownloadPsbt}
          onUploadPsbt={onUploadPsbt}
          onSetDeleteConfirm={onSetDeleteConfirm}
        />
      </div>

      <DraftFlowToggle
        draftId={draft.id}
        isExpanded={isExpanded}
        flowData={flowData}
        onToggleExpand={onToggleExpand}
      />
    </div>
  );
};
