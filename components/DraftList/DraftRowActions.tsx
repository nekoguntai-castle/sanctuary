import React from 'react';
import {
  AlertCircle,
  Download,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';
import type { DraftTransaction } from '../../src/api/drafts';
import { WalletType } from '../../types';
import {
  canShowSingleSigPsbtControls,
  handleDraftPsbtFileSelection,
} from './draftRowData';

interface DraftRowActionsProps {
  draft: DraftTransaction;
  walletType: WalletType;
  canEdit: boolean;
  expired: boolean;
  deleteConfirm: string | null;
  onResume: (draft: DraftTransaction) => void;
  onDelete: (draftId: string) => void;
  onDownloadPsbt: (draft: DraftTransaction) => void;
  onUploadPsbt: (draftId: string, file: File) => void;
  onSetDeleteConfirm: (draftId: string | null) => void;
}

const iconButtonClass = 'p-1.5 rounded-lg text-sanctuary-500 hover:text-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors';

function DraftResumeButton({
  draft,
  expired,
  onResume,
}: Pick<DraftRowActionsProps, 'draft' | 'expired' | 'onResume'>) {
  if (expired) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-sanctuary-300 dark:bg-sanctuary-700 text-sanctuary-500 dark:text-sanctuary-400 cursor-not-allowed">
        <AlertCircle className="w-4 h-4" />
        Expired
      </span>
    );
  }

  return (
    <button
      onClick={() => onResume(draft)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 transition-colors"
    >
      <Play className="w-4 h-4" />
      Resume
    </button>
  );
}

function DraftPsbtControls({
  draft,
  walletType,
  canEdit,
  onDownloadPsbt,
  onUploadPsbt,
}: Pick<DraftRowActionsProps, 'draft' | 'walletType' | 'canEdit' | 'onDownloadPsbt' | 'onUploadPsbt'>) {
  if (!canShowSingleSigPsbtControls(walletType)) return null;

  return (
    <>
      <button
        onClick={() => onDownloadPsbt(draft)}
        className={iconButtonClass}
        title="Download PSBT"
      >
        <Download className="w-4 h-4" />
      </button>

      {canEdit && (
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".psbt,.txt"
            className="hidden"
            onChange={(event) => handleDraftPsbtFileSelection(event, draft.id, onUploadPsbt)}
          />
          <span
            className={`inline-flex ${iconButtonClass}`}
            title="Upload signed PSBT"
          >
            <Upload className="w-4 h-4" />
          </span>
        </label>
      )}
    </>
  );
}

function DraftDeleteControls({
  draft,
  deleteConfirm,
  onDelete,
  onSetDeleteConfirm,
}: Pick<DraftRowActionsProps, 'draft' | 'deleteConfirm' | 'onDelete' | 'onSetDeleteConfirm'>) {
  if (deleteConfirm === draft.id) {
    return (
      <div className="flex items-center gap-1 ml-2">
        <button
          onClick={() => onDelete(draft.id)}
          className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
        >
          Delete
        </button>
        <button
          onClick={() => onSetDeleteConfirm(null)}
          className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => onSetDeleteConfirm(draft.id)}
      className="p-1.5 rounded-lg text-sanctuary-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      title="Delete draft"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}

export const DraftRowActions: React.FC<DraftRowActionsProps> = ({
  draft,
  walletType,
  canEdit,
  expired,
  deleteConfirm,
  onResume,
  onDelete,
  onDownloadPsbt,
  onUploadPsbt,
  onSetDeleteConfirm,
}) => (
  <div className="flex flex-col gap-2">
    <DraftResumeButton draft={draft} expired={expired} onResume={onResume} />

    <div className="flex gap-1">
      <DraftPsbtControls
        draft={draft}
        walletType={walletType}
        canEdit={canEdit}
        onDownloadPsbt={onDownloadPsbt}
        onUploadPsbt={onUploadPsbt}
      />

      {canEdit && (
        <DraftDeleteControls
          draft={draft}
          deleteConfirm={deleteConfirm}
          onDelete={onDelete}
          onSetDeleteConfirm={onSetDeleteConfirm}
        />
      )}
    </div>
  </div>
);
