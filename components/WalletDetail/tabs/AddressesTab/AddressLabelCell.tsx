import { Check, Edit2, Tag, X } from 'lucide-react';
import { LabelBadges } from '../../../LabelSelector';
import type { Address, Label } from '../../../../types';

type AddressLabelCellProps = {
  address: Address;
  editingAddressId: string | null;
  availableLabels: Label[];
  selectedLabelIds: string[];
  savingAddressLabels: boolean;
  onEditAddressLabels: (address: Address) => void;
  onSaveAddressLabels: () => void;
  onToggleAddressLabel: (labelId: string) => void;
  onCancelEditLabels: () => void;
};

export function AddressLabelCell({
  address,
  editingAddressId,
  availableLabels,
  selectedLabelIds,
  savingAddressLabels,
  onEditAddressLabels,
  onSaveAddressLabels,
  onToggleAddressLabel,
  onCancelEditLabels,
}: AddressLabelCellProps) {
  return (
    <td className="px-6 py-4 text-sm">
      {editingAddressId === address.id ? (
        <AddressLabelEditor
          availableLabels={availableLabels}
          selectedLabelIds={selectedLabelIds}
          savingAddressLabels={savingAddressLabels}
          onSaveAddressLabels={onSaveAddressLabels}
          onToggleAddressLabel={onToggleAddressLabel}
          onCancelEditLabels={onCancelEditLabels}
        />
      ) : (
        <AddressLabelReadOnly address={address} onEditAddressLabels={onEditAddressLabels} />
      )}
    </td>
  );
}

function AddressLabelEditor({
  availableLabels,
  selectedLabelIds,
  savingAddressLabels,
  onSaveAddressLabels,
  onToggleAddressLabel,
  onCancelEditLabels,
}: Omit<AddressLabelCellProps, 'address' | 'editingAddressId' | 'onEditAddressLabels'>) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center min-w-[200px]">
      <EditableLabelChoices
        availableLabels={availableLabels}
        selectedLabelIds={selectedLabelIds}
        onToggleAddressLabel={onToggleAddressLabel}
      />
      <div className="flex items-center gap-1 ml-2">
        <button
          onClick={onSaveAddressLabels}
          disabled={savingAddressLabels}
          className="p-1 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:bg-sanctuary-700 dark:hover:bg-sanctuary-600 dark:disabled:bg-sanctuary-800 dark:border dark:border-sanctuary-600 text-white dark:text-sanctuary-100 rounded transition-colors"
          title="Save"
        >
          {savingAddressLabels ? (
            <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent" />
          ) : (
            <Check className="w-3 h-3" />
          )}
        </button>
        <button
          onClick={onCancelEditLabels}
          className="p-1 text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
          title="Cancel"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function EditableLabelChoices({
  availableLabels,
  selectedLabelIds,
  onToggleAddressLabel,
}: {
  availableLabels: Label[];
  selectedLabelIds: string[];
  onToggleAddressLabel: (labelId: string) => void;
}) {
  if (availableLabels.length === 0) {
    return <span className="text-xs text-sanctuary-400">No labels available</span>;
  }

  return (
    <>
      {availableLabels.map(label => (
        <EditableLabelChoice
          key={label.id}
          label={label}
          selected={selectedLabelIds.includes(label.id)}
          onToggleAddressLabel={onToggleAddressLabel}
        />
      ))}
    </>
  );
}

function EditableLabelChoice({
  label,
  selected,
  onToggleAddressLabel,
}: {
  label: Label;
  selected: boolean;
  onToggleAddressLabel: (labelId: string) => void;
}) {
  return (
    <button
      onClick={() => onToggleAddressLabel(label.id)}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white transition-all ${
        selected
          ? 'ring-2 ring-offset-1 ring-sanctuary-500'
          : 'opacity-50 hover:opacity-75'
      }`}
      style={{ backgroundColor: label.color }}
    >
      <Tag className="w-2.5 h-2.5" />
      {label.name}
    </button>
  );
}

function AddressLabelReadOnly({
  address,
  onEditAddressLabels,
}: {
  address: Address;
  onEditAddressLabels: (address: Address) => void;
}) {
  return (
    <div className="flex items-center gap-2 group">
      <AddressLabelValue address={address} />
      {address.id && (
        <button
          onClick={() => onEditAddressLabels(address)}
          className="opacity-0 group-hover:opacity-100 p-1 text-sanctuary-400 hover:text-primary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-all"
          title="Edit labels"
        >
          <Edit2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function AddressLabelValue({ address }: { address: Address }) {
  if (address.labels && address.labels.length > 0) {
    return <LabelBadges labels={address.labels} maxDisplay={2} size="sm" />;
  }

  if (address.label) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300">
        {address.label}
      </span>
    );
  }

  return <span className="text-sanctuary-300">-</span>;
}
