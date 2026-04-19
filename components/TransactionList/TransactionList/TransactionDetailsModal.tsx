import type { Label, Transaction, Wallet } from '../../../types';
import { ActionMenu } from '../ActionMenu';
import { FlowPreview } from '../FlowPreview';
import { LabelEditor } from '../LabelEditor';
import { DetailsSeparator } from './DetailsSeparator';
import { TransactionAddressBlocks } from './TransactionAddressBlocks';
import { TransactionAmountHero } from './TransactionAmountHero';
import { TransactionDetailsHeader } from './TransactionDetailsHeader';
import { TransactionMetadataGrid } from './TransactionMetadataGrid';

type TransactionDetailsModalProps = {
  selectedTx: Transaction;
  wallets: Wallet[];
  walletAddresses: string[];
  explorerUrl: string;
  copied: boolean;
  fullTxDetails: Transaction | null;
  loadingDetails: boolean;
  editingLabels: boolean;
  availableLabels: Label[];
  selectedLabelIds: string[];
  savingLabels: boolean;
  canEdit: boolean;
  aiEnabled: boolean;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  format: (sats: number, options?: { forceSats?: boolean }) => string;
  onClose: () => void;
  onLabelsChange?: () => void;
  onCopyToClipboard: (text: string) => Promise<void>;
  onEditLabels: (tx: Transaction) => void;
  onSaveLabels: () => void;
  onCancelEdit: () => void;
  onToggleLabel: (labelId: string) => void;
  onAISuggestion: (suggestion: string) => void;
};

export function TransactionDetailsModal({
  selectedTx,
  wallets,
  walletAddresses,
  explorerUrl,
  copied,
  fullTxDetails,
  loadingDetails,
  editingLabels,
  availableLabels,
  selectedLabelIds,
  savingLabels,
  canEdit,
  aiEnabled,
  confirmationThreshold,
  deepConfirmationThreshold,
  format,
  onClose,
  onLabelsChange,
  onCopyToClipboard,
  onEditLabels,
  onSaveLabels,
  onCancelEdit,
  onToggleLabel,
  onAISuggestion,
}: TransactionDetailsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="surface-elevated rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-sanctuary-200 dark:border-sanctuary-800 animate-modal-enter" onClick={event => event.stopPropagation()}>
        <TransactionDetailsHeader selectedTx={selectedTx} onClose={onClose} />

        <div className="p-6 space-y-8">
          <TransactionAmountHero
            selectedTx={selectedTx}
            confirmationThreshold={confirmationThreshold}
            deepConfirmationThreshold={deepConfirmationThreshold}
          />
          <ActionMenu
            selectedTx={selectedTx}
            wallets={wallets}
            walletAddresses={walletAddresses}
            explorerUrl={explorerUrl}
            copied={copied}
            onCopyToClipboard={onCopyToClipboard}
            onClose={onClose}
            onLabelsChange={onLabelsChange}
          />
          <FlowPreview
            selectedTx={selectedTx}
            fullTxDetails={fullTxDetails}
            loadingDetails={loadingDetails}
          />

          <div className="space-y-4">
            <DetailsSeparator />
            <TransactionMetadataGrid selectedTx={selectedTx} walletAddresses={walletAddresses} format={format} />
            <TransactionAddressBlocks selectedTx={selectedTx} walletAddresses={walletAddresses} />
            <LabelEditor
              selectedTx={selectedTx}
              editingLabels={editingLabels}
              availableLabels={availableLabels}
              selectedLabelIds={selectedLabelIds}
              savingLabels={savingLabels}
              canEdit={canEdit}
              aiEnabled={aiEnabled}
              onEditLabels={onEditLabels}
              onSaveLabels={onSaveLabels}
              onCancelEdit={onCancelEdit}
              onToggleLabel={onToggleLabel}
              onAISuggestion={onAISuggestion}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
