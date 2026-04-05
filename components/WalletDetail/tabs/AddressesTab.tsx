/**
 * AddressesTab - Address list with receive/change sub-tabs
 *
 * Displays wallet addresses organized by type (receive/change) with
 * summary statistics, label editing, QR codes, and explorer links.
 * Calls useCurrency and useCopyToClipboard hooks internally.
 */

import React from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Check,
  QrCode,
  ExternalLink,
  MapPin,
  Plus,
  Tag,
  Edit2,
  X,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import { LabelBadges } from '../../LabelSelector';
import { truncateAddress } from '../../../utils/formatters';
import { getAddressExplorerUrl } from '../../../utils/explorer';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import type { Address, Label } from '../../../types';
import type { AddressSummary } from '../../../src/api/transactions';
import type { AddressSubTab } from '../types';

interface AddressesTabProps {
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
}

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

  // Helper to determine if address is a change address based on derivation path
  // Standard BIP derivation: m/purpose'/coin'/account'/change/index
  // change = 0 for external/receive, 1 for internal/change
  const isChangeAddress = (addr: Address): boolean => {
    if (typeof addr.isChange === 'boolean') {
      return addr.isChange;
    }
    const parts = addr.derivationPath.split('/');
    if (parts.length >= 2) {
      // Second-to-last part is the change indicator
      const changeIndicator = parts[parts.length - 2];
      return changeIndicator === '1';
    }
    return false;
  };

  const receiveAddresses = addresses.filter(addr => !isChangeAddress(addr));
  const changeAddresses = addresses.filter(addr => isChangeAddress(addr));

  // Render the address table content
  const renderAddressTableContent = (addressList: Address[], emptyMessage: string) => (
    addressList.length === 0 ? (
      <div className="p-8 text-center text-sanctuary-500 text-sm">
        {emptyMessage}
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
          <thead className="surface-muted">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Index</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Address</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Label</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Balance</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
            {addressList.map((addr) => (
              <tr key={addr.address} className="hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-sanctuary-500 font-mono">
                  #{addr.index}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center space-x-2">
                    <span
                      className="text-sm font-mono text-sanctuary-700 dark:text-sanctuary-300 cursor-default"
                      title={addr.address}
                    >
                      {truncateAddress(addr.address)}
                    </span>
                    <button
                      className={`transition-colors ${isCopied(addr.address) ? 'text-success-500' : 'text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300'}`}
                      onClick={() => copy(addr.address)}
                      title={isCopied(addr.address) ? 'Copied!' : 'Copy address'}
                    >
                      {isCopied(addr.address) ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                    <button
                      className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
                      onClick={() => onShowQrModal(addr.address)}
                      title="Show QR code"
                    >
                      <QrCode className="w-3 h-3" />
                    </button>
                    <a
                      href={getAddressExplorerUrl(addr.address, network || 'mainnet', explorerUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sanctuary-400 hover:text-primary-500 dark:hover:text-primary-400"
                      title="View on block explorer"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm">
                  {editingAddressId === addr.id ? (
                    <div className="flex flex-wrap gap-1.5 items-center min-w-[200px]">
                      {availableLabels.length === 0 ? (
                        <span className="text-xs text-sanctuary-400">No labels available</span>
                      ) : (
                        <>
                          {availableLabels.map(label => {
                            const isSelected = selectedLabelIds.includes(label.id);
                            return (
                              <button
                                key={label.id}
                                onClick={() => onToggleAddressLabel(label.id)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white transition-all ${
                                  isSelected
                                    ? 'ring-2 ring-offset-1 ring-sanctuary-500'
                                    : 'opacity-50 hover:opacity-75'
                                }`}
                                style={{ backgroundColor: label.color }}
                              >
                                <Tag className="w-2.5 h-2.5" />
                                {label.name}
                              </button>
                            );
                          })}
                        </>
                      )}
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
                  ) : (
                    <div className="flex items-center gap-2 group">
                      {(addr.labels && addr.labels.length > 0) ? (
                        <LabelBadges labels={addr.labels} maxDisplay={2} size="sm" />
                      ) : addr.label ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300">
                          {addr.label}
                        </span>
                      ) : (
                        <span className="text-sanctuary-300">-</span>
                      )}
                      {addr.id && (
                        <button
                          onClick={() => onEditAddressLabels(addr)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-sanctuary-400 hover:text-primary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-all"
                          title="Edit labels"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  {addr.balance > 0 ? format(addr.balance) : (addr.used ? format(0) : '-')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${addr.used ? 'bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-100' : 'bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300'}`}>
                    {addr.used ? 'Used' : 'Unused'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {addressSummary && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
            <p className="text-xs uppercase tracking-wide text-sanctuary-500">Total Addresses</p>
            <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
              {addressSummary.totalAddresses}
            </p>
            <p className="text-xs text-sanctuary-500 mt-2">
              {addressSummary.usedCount} used · {addressSummary.unusedCount} unused
            </p>
          </div>
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
            <p className="text-xs uppercase tracking-wide text-sanctuary-500">Total Balance</p>
            <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
              {format(addressSummary.totalBalance)}
            </p>
          </div>
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
            <p className="text-xs uppercase tracking-wide text-sanctuary-500">Used Balance</p>
            <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
              {format(addressSummary.usedBalance)}
            </p>
          </div>
          <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
            <p className="text-xs uppercase tracking-wide text-sanctuary-500">Unused Balance</p>
            <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
              {format(addressSummary.unusedBalance)}
            </p>
          </div>
        </div>
      )}
      {addresses.length === 0 ? (
        <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
          <MapPin className="w-12 h-12 mx-auto text-sanctuary-300 dark:text-sanctuary-600 mb-4" />
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">No Addresses Available</h3>
          <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 mb-4 max-w-md mx-auto">
            {!descriptor
              ? "This wallet doesn't have a descriptor. Please link a hardware device with an xpub to generate addresses."
              : "No addresses have been generated yet. Click below to generate addresses."}
          </p>
          {descriptor && (
            <Button variant="primary" onClick={onGenerateMoreAddresses} isLoading={loadingAddresses}>
              <Plus className="w-4 h-4 mr-2" /> Generate Addresses
            </Button>
          )}
        </div>
      ) : (
        <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
          {/* Sub-tabs Header */}
          <div className="px-6 py-3 surface-muted border-b border-sanctuary-100 dark:border-sanctuary-800">
            <div className="flex items-center justify-between">
              <div className="flex space-x-1">
                <button
                  onClick={() => onAddressSubTabChange('receive')}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    addressSubTab === 'receive'
                      ? 'bg-white dark:bg-sanctuary-800 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                  }`}
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>Receive</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    addressSubTab === 'receive'
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                      : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500'
                  }`}>
                    {receiveAddresses.length}
                  </span>
                </button>
                <button
                  onClick={() => onAddressSubTabChange('change')}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    addressSubTab === 'change'
                      ? 'bg-white dark:bg-sanctuary-800 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Change</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    addressSubTab === 'change'
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                      : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500'
                  }`}>
                    {changeAddresses.length}
                  </span>
                </button>
              </div>
             <Button variant="ghost" size="sm" onClick={onGenerateMoreAddresses} isLoading={loadingAddresses}>
               <Plus className="w-4 h-4 mr-1" /> Generate
             </Button>
            </div>
          </div>

          {/* Address Table Content */}
          {addressSubTab === 'receive' && renderAddressTableContent(
            receiveAddresses,
            "No receive addresses generated yet"
          )}
          {addressSubTab === 'change' && renderAddressTableContent(
            changeAddresses,
            "No change addresses used yet. Change addresses are created when you send Bitcoin."
          )}
        </div>
      )}
      {addresses.length > 0 && (
        <div className="flex items-center justify-between text-sm text-sanctuary-500">
          <span>
            Showing {addresses.length} of {addressSummary?.totalAddresses ?? addresses.length} addresses
          </span>
          <div className="flex items-center gap-2">
            {hasMoreAddresses ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onLoadMoreAddresses}
                isLoading={loadingAddresses}
              >
                Load More
              </Button>
            ) : (
              <span className="text-xs text-sanctuary-400">All addresses loaded</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
