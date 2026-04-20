import type { Address, Label } from '../../../../types';
import type { AddressSummary } from '../../../../src/api/transactions';
import type { AddressSubTab } from '../../types';

export type AddressesTabProps = {
  addresses: Address[];
  addressSummary: AddressSummary | null;
  addressSubTab: AddressSubTab;
  onAddressSubTabChange: (tab: AddressSubTab) => void;
  descriptor: string | null;
  network: string;
  loadingAddresses: boolean;
  hasMoreAddresses: boolean;
  onLoadMoreAddresses: () => void;
  onGenerateMoreAddresses: () => void;
  editingAddressId: string | null;
  availableLabels: Label[];
  selectedLabelIds: string[];
  onEditAddressLabels: (addr: Address) => void;
  onSaveAddressLabels: () => void;
  onToggleAddressLabel: (labelId: string) => void;
  savingAddressLabels: boolean;
  onCancelEditLabels: () => void;
  onShowQrModal: (address: string) => void;
  explorerUrl: string;
};

export type AddressGroups = {
  receiveAddresses: Address[];
  changeAddresses: Address[];
};

export type AddressFormat = (sats: number) => string;
export type CopyAddress = (address: string) => void | Promise<unknown>;
export type IsAddressCopied = (address: string) => boolean;
