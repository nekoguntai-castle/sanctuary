import { ActionMenu } from '../ActionMenu';
import { FlowPreview } from '../FlowPreview';
import { LabelEditor } from '../LabelEditor';
import { DetailsSeparator } from './DetailsSeparator';
import { TransactionAddressBlocks } from './TransactionAddressBlocks';
import { TransactionAmountHero } from './TransactionAmountHero';
import { TransactionMetadataGrid } from './TransactionMetadataGrid';
import type { TransactionDetailsContentProps } from './types';

/**
 * The transaction-details body — amount hero, action menu, flow preview, and the
 * metadata / address / label section. Extracted from `TransactionDetailsModal`
 * so the phone modal and the tablet+ split pane render byte-identical content.
 */
export function TransactionDetailsBody({
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
  labelMutationError,
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
}: TransactionDetailsContentProps) {
  return (
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
          mutationError={labelMutationError}
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
  );
}
