import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, AlertCircle, Clock } from 'lucide-react';
import { DraftTransaction, getDrafts, deleteDraft, updateDraft } from '../../src/api/drafts';
import { WalletType } from '../../types';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useLoadingState } from '../../hooks/useLoadingState';
import { createLogger } from '../../utils/logger';
import { downloadBlob } from '../../utils/download';
import { DraftRow } from './DraftRow';
import { DraftListProps, ExpirationUrgency } from './types';
import { getExpirationInfo } from './utils';

const log = createLogger('DraftList');

export const DraftList: React.FC<DraftListProps> = ({
  walletId,
  walletType,
  quorum,
  onResume,
  canEdit = true,
  onDraftsChange,
  walletAddresses = [],
  walletName,
}) => {
  const navigate = useNavigate();
  const { format } = useCurrency();

  // Create a set of known wallet addresses for quick lookup
  const knownAddresses = React.useMemo(() => {
    return new Set(walletAddresses.map(wa => wa.address));
  }, [walletAddresses]);

  // Helper to get label for an address if it belongs to our wallet
  const getAddressLabel = React.useCallback((address: string): string | undefined => {
    if (knownAddresses.has(address)) {
      return walletName || 'Own wallet';
    }
    return undefined;
  }, [knownAddresses, walletName]);

  const [drafts, setDrafts] = useState<DraftTransaction[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);

  // Loading states using hook
  const { loading, error, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { error: operationError, execute: runOperation } = useLoadingState();

  // Combined error display
  const displayError = error || operationError;

  useEffect(() => {
    loadDrafts();
  }, [walletId]);

  const loadDrafts = () => runLoad(async () => {
    log.debug('Loading drafts for wallet', { walletId });
    const data = await getDrafts(walletId);
    log.debug('Loaded drafts', { count: data.length });
    setDrafts(data);
    onDraftsChange?.(data.length);
  });

  // Sort drafts: expired first (for visibility), then by expiration (soonest first), then by creation date
  const sortedDrafts = React.useMemo(() => {
    return [...drafts].sort((a, b) => {
      const aExp = getExpirationInfo(a.expiresAt);
      const bExp = getExpirationInfo(b.expiresAt);

      // If one has expiration and the other doesn't, prioritize the one with expiration
      if (aExp && !bExp) return -1;
      if (!aExp && bExp) return 1;
      if (!aExp && !bExp) {
        // Both without expiration - sort by creation date (newest first)
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }

      // Both have expiration - sort by urgency then by time remaining
      const urgencyOrder: Record<ExpirationUrgency, number> = {
        expired: 0,
        critical: 1,
        warning: 2,
        normal: 3,
      };

      const aUrgency = urgencyOrder[aExp!.urgency];
      const bUrgency = urgencyOrder[bExp!.urgency];

      if (aUrgency !== bUrgency) {
        return aUrgency - bUrgency;
      }

      // Same urgency - sort by time remaining (soonest first)
      return aExp!.diffMs - bExp!.diffMs;
    });
  }, [drafts]);

  const handleResume = (draft: DraftTransaction) => {
    if (onResume) {
      onResume(draft);
    } else {
      // Navigate to send page with draft data
      navigate(`/wallets/${walletId}/send`, { state: { draft } });
    }
  };

  const handleDelete = async (draftId: string) => {
    const result = await runOperation(async () => {
      await deleteDraft(walletId, draftId);
    });

    if (result !== null) {
      const newDrafts = drafts.filter(d => d.id !== draftId);
      setDrafts(newDrafts);
      setDeleteConfirm(null);
      onDraftsChange?.(newDrafts.length);
    }
  };

  const handleDownloadPsbt = (draft: DraftTransaction) => {
    const psbtToDownload = draft.signedPsbtBase64 || draft.psbtBase64;
    // Convert base64 to binary (BIP 174 standard format for .psbt files)
    const binaryString = atob(psbtToDownload);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    downloadBlob(blob, `sanctuary-draft-${draft.id.slice(0, 8)}.psbt`);
  };

  const handleUploadPsbt = async (draftId: string, file: File) => {
    const result = await runOperation(async () => {
      // Read file as binary first to detect format
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      let signedPsbt: string;

      // Check for PSBT magic bytes: "psbt" + 0xff
      const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (magic === 'psbt' && bytes[4] === 0xff) {
        // Binary PSBT - convert to base64
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        signedPsbt = btoa(binary);
        log.info('Loaded binary PSBT from file', { size: bytes.length });
      } else {
        // Try reading as text (base64 or hex)
        const text = await file.text();
        const content = text.trim();

        // Check if it's base64
        const base64Match = content.match(/^[A-Za-z0-9+/=\s]+$/);
        if (base64Match) {
          const cleanBase64 = content.replace(/\s/g, '');
          // Validate it's a valid PSBT by checking magic bytes after decode
          try {
            const decoded = atob(cleanBase64);
            if (decoded.startsWith('psbt')) {
              signedPsbt = cleanBase64;
              log.info('Loaded base64 PSBT from file');
            } else {
              throw new Error('Not a valid PSBT (missing magic bytes)');
            }
          } catch {
            throw new Error('Invalid base64 PSBT file');
          }
        } else {
          // Check if it's hex
          const hexMatch = content.match(/^[0-9a-fA-F\s]+$/);
          if (hexMatch) {
            const cleanHex = content.replace(/\s/g, '');
            const hexBytes = new Uint8Array(cleanHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            let binary = '';
            for (let i = 0; i < hexBytes.length; i++) {
              binary += String.fromCharCode(hexBytes[i]);
            }
            signedPsbt = btoa(binary);
            log.info('Converted hex PSBT to base64');
          } else {
            throw new Error('Invalid PSBT file format. Expected binary, base64, or hex.');
          }
        }
      }

      // Update the draft with the signed PSBT
      const draft = drafts.find(d => d.id === draftId);
      if (!draft) return;

      // Determine new status
      const isMultisig = walletType === WalletType.MULTI_SIG;
      const newStatus = isMultisig ? 'partial' : 'signed';

      await updateDraft(walletId, draftId, {
        signedPsbtBase64: signedPsbt,
        status: newStatus,
      });
    });

    if (result !== null) {
      // Reload drafts to get updated data
      await loadDrafts();
      setUploadingFor(null);
    }
  };

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
            onToggleExpand={(id) => setExpandedDraft(expandedDraft === id ? null : id)}
            onSetDeleteConfirm={setDeleteConfirm}
          />
        ))}
      </div>
    </div>
  );
};

export default DraftList;
