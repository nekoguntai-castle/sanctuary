import type { Address, Label } from '../../../../types';
import type { AddressFormat, CopyAddress, IsAddressCopied } from './types';
import { AddressActionsCell } from './AddressActionsCell';
import { AddressLabelCell } from './AddressLabelCell';
import { getAddressBalanceLabel } from './addressDisplay';

type AddressRowProps = {
  address: Address;
  editingAddressId: string | null;
  availableLabels: Label[];
  selectedLabelIds: string[];
  savingAddressLabels: boolean;
  network: string;
  explorerUrl: string;
  format: AddressFormat;
  copy: CopyAddress;
  isCopied: IsAddressCopied;
  onShowQrModal: (address: string) => void;
  onEditAddressLabels: (address: Address) => void;
  onSaveAddressLabels: () => void;
  onToggleAddressLabel: (labelId: string) => void;
  onCancelEditLabels: () => void;
};

export function AddressRow({
  address,
  editingAddressId,
  availableLabels,
  selectedLabelIds,
  savingAddressLabels,
  network,
  explorerUrl,
  format,
  copy,
  isCopied,
  onShowQrModal,
  onEditAddressLabels,
  onSaveAddressLabels,
  onToggleAddressLabel,
  onCancelEditLabels,
}: AddressRowProps) {
  return (
    <tr className="hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
      <td className="px-6 py-4 whitespace-nowrap text-sm text-sanctuary-500 font-mono">
        #{address.index}
      </td>
      <AddressActionsCell
        address={address}
        network={network}
        explorerUrl={explorerUrl}
        copy={copy}
        isCopied={isCopied}
        onShowQrModal={onShowQrModal}
      />
      <AddressLabelCell
        address={address}
        editingAddressId={editingAddressId}
        availableLabels={availableLabels}
        selectedLabelIds={selectedLabelIds}
        savingAddressLabels={savingAddressLabels}
        onEditAddressLabels={onEditAddressLabels}
        onSaveAddressLabels={onSaveAddressLabels}
        onToggleAddressLabel={onToggleAddressLabel}
        onCancelEditLabels={onCancelEditLabels}
      />
      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-sanctuary-900 dark:text-sanctuary-100">
        {getAddressBalanceLabel(address, format)}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
        <AddressStatusBadge used={address.used} />
      </td>
    </tr>
  );
}

function AddressStatusBadge({ used }: { used: boolean }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
      used
        ? 'bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-100'
        : 'bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300'
    }`}>
      {used ? 'Used' : 'Unused'}
    </span>
  );
}
