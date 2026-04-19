import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteDraft, DraftTransaction, getDrafts, updateDraft } from '../../src/api/drafts';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useLoadingState } from '../../hooks/useLoadingState';
import { createLogger } from '../../utils/logger';
import { downloadBlob } from '../../utils/download';
import { DraftListProps } from './types';
import {
  createPsbtBlob,
  getDownloadablePsbt,
  getDraftPsbtFilename,
  getSignedDraftStatus,
  ParsedPsbtFile,
  readSignedPsbtFile,
  sortDraftsByExpiration,
} from './draftListHelpers';

const log = createLogger('DraftList');

export interface DraftListController {
  deleteConfirm: string | null;
  displayError: string | null;
  drafts: DraftTransaction[];
  expandedDraft: string | null;
  format: (sats: number) => string;
  getAddressLabel: (address: string) => string | undefined;
  handleDelete: (draftId: string) => Promise<void>;
  handleDownloadPsbt: (draft: DraftTransaction) => void;
  handleResume: (draft: DraftTransaction) => void;
  handleUploadPsbt: (draftId: string, file: File) => Promise<void>;
  loading: boolean;
  loadDrafts: () => Promise<DraftTransaction[] | null>;
  setDeleteConfirm: (draftId: string | null) => void;
  sortedDrafts: DraftTransaction[];
  toggleExpandedDraft: (draftId: string) => void;
}

export function useDraftListController({
  onDraftsChange,
  onResume,
  walletAddresses = [],
  walletId,
  walletName,
  walletType,
}: DraftListProps): DraftListController {
  const navigate = useNavigate();
  const { format } = useCurrency();
  const [drafts, setDrafts] = useState<DraftTransaction[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const { loading, error, execute: runLoad } = useLoadingState<DraftTransaction[]>({ initialLoading: true });
  const { error: operationError, execute: runOperation } = useLoadingState();

  const knownAddresses = React.useMemo(() => {
    return new Set(walletAddresses.map(wa => wa.address));
  }, [walletAddresses]);

  const getAddressLabel = React.useCallback((address: string): string | undefined => {
    return getKnownAddressLabel(knownAddresses, walletName, address);
  }, [knownAddresses, walletName]);

  const sortedDrafts = React.useMemo(() => sortDraftsByExpiration(drafts), [drafts]);
  const displayError = error || operationError;

  const loadDrafts = React.useCallback(() => runLoad(async () => {
    log.debug('Loading drafts for wallet', { walletId });
    const data = await getDrafts(walletId);
    log.debug('Loaded drafts', { count: data.length });
    setDrafts(data);
    onDraftsChange?.(data.length);
    return data;
  }), [onDraftsChange, runLoad, walletId]);

  useEffect(() => {
    void loadDrafts();
  }, [walletId]);

  const handleResume = React.useCallback((draft: DraftTransaction) => {
    if (onResume) {
      onResume(draft);
    } else {
      navigate(`/wallets/${walletId}/send`, { state: { draft } });
    }
  }, [navigate, onResume, walletId]);

  const handleDelete = React.useCallback(async (draftId: string) => {
    const result = await runOperation(async () => {
      await deleteDraft(walletId, draftId);
    });

    if (result !== null) {
      const newDrafts = drafts.filter(d => d.id !== draftId);
      setDrafts(newDrafts);
      setDeleteConfirm(null);
      onDraftsChange?.(newDrafts.length);
    }
  }, [drafts, onDraftsChange, runOperation, walletId]);

  const handleDownloadPsbt = React.useCallback((draft: DraftTransaction) => {
    downloadBlob(createPsbtBlob(getDownloadablePsbt(draft)), getDraftPsbtFilename(draft.id));
  }, []);

  const handleUploadPsbt = React.useCallback(async (draftId: string, file: File) => {
    const result = await runOperation(async () => {
      const signedPsbt = await readSignedPsbtFile(file);
      logParsedPsbtFile(signedPsbt);

      const draft = drafts.find(d => d.id === draftId);
      if (!draft) return;

      await updateDraft(walletId, draftId, {
        signedPsbtBase64: signedPsbt.base64,
        status: getSignedDraftStatus(walletType),
      });
    });

    if (result !== null) {
      await loadDrafts();
    }
  }, [drafts, loadDrafts, runOperation, walletId, walletType]);

  const toggleExpandedDraft = React.useCallback((draftId: string) => {
    setExpandedDraft(current => (current === draftId ? null : draftId));
  }, []);

  return {
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
  };
}

function getKnownAddressLabel(
  knownAddresses: Set<string>,
  walletName: string | undefined,
  address: string,
): string | undefined {
  if (!knownAddresses.has(address)) return undefined;

  return walletName || 'Own wallet';
}

function logParsedPsbtFile(signedPsbt: ParsedPsbtFile) {
  if (signedPsbt.format === 'binary') {
    log.info('Loaded binary PSBT from file', { size: signedPsbt.byteLength });
  } else if (signedPsbt.format === 'base64') {
    log.info('Loaded base64 PSBT from file');
  } else {
    log.info('Converted hex PSBT to base64');
  }
}
