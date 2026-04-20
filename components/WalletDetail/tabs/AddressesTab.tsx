/**
 * AddressesTab - Address list with receive/change sub-tabs
 *
 * Displays wallet addresses organized by type (receive/change) with
 * summary statistics, label editing, QR codes, and explorer links.
 * Calls useCurrency and useCopyToClipboard hooks internally.
 */

import React from 'react';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { AddressFooter } from './AddressesTab/AddressFooter';
import { AddressListPanel } from './AddressesTab/AddressListPanel';
import { AddressSummaryGrid } from './AddressesTab/AddressSummaryGrid';
import { EmptyAddressesState } from './AddressesTab/EmptyAddressesState';
import { splitAddresses } from './AddressesTab/addressModel';
import type { AddressesTabProps } from './AddressesTab/types';

export const AddressesTab: React.FC<AddressesTabProps> = ({
  addresses,
  addressSummary,
  addressSubTab,
  onAddressSubTabChange,
  descriptor,
  network,
  loadingAddresses,
  hasMoreAddresses,
  onLoadMoreAddresses,
  onGenerateMoreAddresses,
  editingAddressId,
  availableLabels,
  selectedLabelIds,
  onEditAddressLabels,
  onSaveAddressLabels,
  onToggleAddressLabel,
  savingAddressLabels,
  onCancelEditLabels,
  onShowQrModal,
  explorerUrl,
}) => {
  const { format } = useCurrency();
  const { copy, isCopied } = useCopyToClipboard();
  const { receiveAddresses, changeAddresses } = splitAddresses(addresses);

  return (
    <div className="space-y-4 animate-fade-in">
      <AddressSummaryGrid addressSummary={addressSummary} format={format} />
      {addresses.length === 0 ? (
        <EmptyAddressesState
          descriptor={descriptor}
          loadingAddresses={loadingAddresses}
          onGenerateMoreAddresses={onGenerateMoreAddresses}
        />
      ) : (
        <AddressListPanel
          receiveAddresses={receiveAddresses}
          changeAddresses={changeAddresses}
          addressSubTab={addressSubTab}
          loadingAddresses={loadingAddresses}
          editingAddressId={editingAddressId}
          availableLabels={availableLabels}
          selectedLabelIds={selectedLabelIds}
          savingAddressLabels={savingAddressLabels}
          network={network}
          explorerUrl={explorerUrl}
          format={format}
          copy={copy}
          isCopied={isCopied}
          onAddressSubTabChange={onAddressSubTabChange}
          onGenerateMoreAddresses={onGenerateMoreAddresses}
          onShowQrModal={onShowQrModal}
          onEditAddressLabels={onEditAddressLabels}
          onSaveAddressLabels={onSaveAddressLabels}
          onToggleAddressLabel={onToggleAddressLabel}
          onCancelEditLabels={onCancelEditLabels}
        />
      )}
      <AddressFooter
        addressCount={addresses.length}
        totalAddresses={addressSummary?.totalAddresses ?? addresses.length}
        hasMoreAddresses={hasMoreAddresses}
        loadingAddresses={loadingAddresses}
        onLoadMoreAddresses={onLoadMoreAddresses}
      />
    </div>
  );
};
