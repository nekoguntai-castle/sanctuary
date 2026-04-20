import type { Address, Label } from '../../../../types';
import type { AddressSubTab } from '../../types';
import { AddressSubTabs } from './AddressSubTabs';
import { AddressTable } from './AddressTable';
import type { AddressFormat, CopyAddress, IsAddressCopied } from './types';

type AddressListPanelProps = {
  receiveAddresses: Address[];
  changeAddresses: Address[];
  addressSubTab: AddressSubTab;
  loadingAddresses: boolean;
  editingAddressId: string | null;
  availableLabels: Label[];
  selectedLabelIds: string[];
  savingAddressLabels: boolean;
  network: string;
  explorerUrl: string;
  format: AddressFormat;
  copy: CopyAddress;
  isCopied: IsAddressCopied;
  onAddressSubTabChange: (tab: AddressSubTab) => void;
  onGenerateMoreAddresses: () => void;
  onShowQrModal: (address: string) => void;
  onEditAddressLabels: (address: Address) => void;
  onSaveAddressLabels: () => void;
  onToggleAddressLabel: (labelId: string) => void;
  onCancelEditLabels: () => void;
};

export function AddressListPanel({
  receiveAddresses,
  changeAddresses,
  addressSubTab,
  loadingAddresses,
  editingAddressId,
  availableLabels,
  selectedLabelIds,
  savingAddressLabels,
  network,
  explorerUrl,
  format,
  copy,
  isCopied,
  onAddressSubTabChange,
  onGenerateMoreAddresses,
  onShowQrModal,
  onEditAddressLabels,
  onSaveAddressLabels,
  onToggleAddressLabel,
  onCancelEditLabels,
}: AddressListPanelProps) {
  const addressList = addressSubTab === 'receive' ? receiveAddresses : changeAddresses;
  const emptyMessage = addressSubTab === 'receive'
    ? 'No receive addresses generated yet'
    : 'No change addresses used yet. Change addresses are created when you send Bitcoin.';

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <AddressSubTabs
        addressSubTab={addressSubTab}
        receiveCount={receiveAddresses.length}
        changeCount={changeAddresses.length}
        loadingAddresses={loadingAddresses}
        onAddressSubTabChange={onAddressSubTabChange}
        onGenerateMoreAddresses={onGenerateMoreAddresses}
      />
      <AddressTable
        addressList={addressList}
        emptyMessage={emptyMessage}
        editingAddressId={editingAddressId}
        availableLabels={availableLabels}
        selectedLabelIds={selectedLabelIds}
        savingAddressLabels={savingAddressLabels}
        network={network}
        explorerUrl={explorerUrl}
        format={format}
        copy={copy}
        isCopied={isCopied}
        onShowQrModal={onShowQrModal}
        onEditAddressLabels={onEditAddressLabels}
        onSaveAddressLabels={onSaveAddressLabels}
        onToggleAddressLabel={onToggleAddressLabel}
        onCancelEditLabels={onCancelEditLabels}
      />
    </div>
  );
}
