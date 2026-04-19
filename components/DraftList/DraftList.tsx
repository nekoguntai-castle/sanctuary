import React from 'react';
import { FileText, AlertCircle, Clock } from 'lucide-react';
import { DraftRow } from './DraftRow';
import { DraftListProps } from './types';
import { useDraftListController } from './useDraftListController';

export const DraftList: React.FC<DraftListProps> = ({
  walletType,
  quorum,
  canEdit = true,
  ...controllerProps
}) => {
  const {
    deleteConfirm,
    displayError,
    drafts,
    expandedDraft,
    format,
    getAddressLabel,
    handleDelete,
    handleDownloadPsbt,
    handleResume,
    handleUploadPsbt,
    loading,
    loadDrafts,
    setDeleteConfirm,
    sortedDrafts,
    toggleExpandedDraft,
  } = useDraftListController({ walletType, ...controllerProps });

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center gap-2 text-sanctuary-400">
          <Clock className="w-5 h-5 animate-pulse" />
          Loading drafts...
        </div>
      </div>
    );
  }

  if (displayError) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center gap-2 text-red-500">
          <AlertCircle className="w-5 h-5" />
          {displayError}
        </div>
        <button
          onClick={loadDrafts}
          className="mt-4 text-primary-600 hover:text-primary-700 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="text-center py-10">
        <FileText className="w-12 h-12 mx-auto text-sanctuary-300 dark:text-sanctuary-600 mb-4" />
        <p className="text-sanctuary-500 dark:text-sanctuary-400">No draft transactions</p>
        <p className="text-sm text-sanctuary-400 dark:text-sanctuary-500 mt-1">
          Create a transaction and save it as a draft to resume later
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
          Draft Transactions
        </h3>
        <span className="text-sm text-sanctuary-500">
          {drafts.length} draft{drafts.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-3">
        {sortedDrafts.map((draft) => (
          <DraftRow
            key={draft.id}
            draft={draft}
            walletType={walletType}
            quorum={quorum}
            canEdit={canEdit}
            isExpanded={expandedDraft === draft.id}
            deleteConfirm={deleteConfirm}
            format={format}
            getAddressLabel={getAddressLabel}
            onResume={handleResume}
            onDelete={handleDelete}
            onDownloadPsbt={handleDownloadPsbt}
            onUploadPsbt={handleUploadPsbt}
            onToggleExpand={toggleExpandedDraft}
            onSetDeleteConfirm={setDeleteConfirm}
          />
        ))}
      </div>
    </div>
  );
};

export default DraftList;
