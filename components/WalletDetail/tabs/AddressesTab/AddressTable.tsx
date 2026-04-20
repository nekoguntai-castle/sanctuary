import type { Address, Label } from '../../../../types';
import { AddressRow } from './AddressRow';
import type { AddressFormat, CopyAddress, IsAddressCopied } from './types';

type AddressTableProps = {
  addressList: Address[];
  emptyMessage: string;
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

export function AddressTable({
  addressList,
  emptyMessage,
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
}: AddressTableProps) {
  if (addressList.length === 0) {
    return (
      <div className="p-8 text-center text-sanctuary-500 text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
        <AddressTableHead />
        <tbody className="divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
          {addressList.map((address) => (
            <AddressRow
              key={address.address}
              address={address}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddressTableHead() {
  return (
    <thead className="surface-muted">
      <tr>
        <HeaderCell label="Index" align="left" />
        <HeaderCell label="Address" align="left" />
        <HeaderCell label="Label" align="left" />
        <HeaderCell label="Balance" align="right" />
        <HeaderCell label="Status" align="right" />
      </tr>
    </thead>
  );
}

function HeaderCell({ label, align }: { label: string; align: 'left' | 'right' }) {
  const alignClass = getHeaderAlignClass(align);

  return (
    <th scope="col" className={`px-6 py-3 ${alignClass} text-xs font-medium text-sanctuary-500 uppercase tracking-wider`}>
      {label}
    </th>
  );
}

function getHeaderAlignClass(align: 'left' | 'right'): string {
  return align === 'right' ? 'text-right' : 'text-left';
}
