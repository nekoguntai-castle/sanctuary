/**
 * ReceiveModal Component
 *
 * Modal for generating and displaying receive addresses with QR codes.
 * Supports Payjoin and BIP21 URI generation.
 *
 * When all loaded addresses are used, automatically fetches more via
 * onFetchUnusedAddresses callback to handle address exhaustion at any index.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, RefreshCw, Copy, Check } from 'lucide-react';
import { Button } from '../../ui/Button';
import { PayjoinSection } from '../../PayjoinSection';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import * as payjoinApi from '../../../src/api/payjoin';
import { createLogger } from '../../../utils/logger';
import type { Address } from '../../../types';

const log = createLogger('ReceiveModal');

interface ReceiveModalProps {
  walletId: string;
  addresses: Address[];
  onClose: () => void;
  onNavigateToSettings: () => void;
  /** Callback to fetch unused receive addresses when all loaded ones are exhausted. */
  onFetchUnusedAddresses?: (walletId: string) => Promise<Address[]>;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  walletId,
  addresses,
  onClose,
  onNavigateToSettings,
  onFetchUnusedAddresses,
}) => {
  const { copy, isCopied } = useCopyToClipboard();

  // Fetched unused addresses (when prop addresses are all exhausted)
  const [fetchedAddresses, setFetchedAddresses] = useState<Address[]>([]);
  const [fetchingAddress, setFetchingAddress] = useState(false);
  const fetchAttemptedRef = useRef(false);

  // Get unused receive addresses (not change addresses) from both props and fetched
  const unusedReceiveAddresses = useMemo(() => {
    const fromProps = addresses.filter((a) => !a.isChange && !a.used);
    if (fromProps.length > 0) return fromProps;
    return fetchedAddresses.filter((a) => !a.isChange && !a.used);
  }, [addresses, fetchedAddresses]);

  // Auto-fetch unused addresses when loaded addresses are all used (exhaustion).
  // Skip when addresses is empty (no descriptor / no device — show error immediately).
  // Skip when no fetch callback is provided.
  useEffect(() => {
    const unusedFromProps = addresses.filter((a) => !a.isChange && !a.used);
    if (unusedFromProps.length > 0 || fetchAttemptedRef.current || addresses.length === 0 || !onFetchUnusedAddresses) return;

    fetchAttemptedRef.current = true;
    setFetchingAddress(true);

    onFetchUnusedAddresses(walletId)
      .then((result) => setFetchedAddresses(result))
      .catch((err) => log.error('Failed to fetch unused receive address', { error: err }))
      .finally(() => setFetchingAddress(false));
  }, [walletId, addresses, onFetchUnusedAddresses]);

  // Selected address state
  const [selectedReceiveAddressId, setSelectedReceiveAddressId] = useState<string | null>(null);

  // Payjoin: only show when feature flag is enabled AND public URL is configured
  const [payjoinAvailable, setPayjoinAvailable] = useState(false);

  useEffect(() => {
    const checkPayjoinStatus = async () => {
      try {
        const status = await payjoinApi.getPayjoinStatus();
        setPayjoinAvailable(status.enabled && status.configured);
      } catch (error) {
        log.debug('Failed to check payjoin status', { error });
        setPayjoinAvailable(false);
      }
    };
    checkPayjoinStatus();
  }, []);

  // Payjoin state
  const [payjoinEnabled, setPayjoinEnabled] = useState(false);
  const [payjoinUri, setPayjoinUri] = useState<string | null>(null);
  const [payjoinLoading, setPayjoinLoading] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState('');

  // Get the selected address or first unused
  const selectedReceiveAddress = useMemo(() => {
    if (selectedReceiveAddressId) {
      const selected = unusedReceiveAddresses.find((a) => a.id === selectedReceiveAddressId);
      if (selected) {
        return selected;
      }
    }
    return unusedReceiveAddresses[0];
  }, [unusedReceiveAddresses, selectedReceiveAddressId]);

  const receiveAddress = selectedReceiveAddress?.address || '';
  const displayValue = payjoinUri || receiveAddress;

  // Generate Payjoin URI when enabled
  useEffect(() => {
    if (!payjoinEnabled || !receiveAddress || !selectedReceiveAddress || !walletId) {
      setPayjoinUri(null);
      return;
    }

    const generatePayjoinUri = async () => {
      setPayjoinLoading(true);
      try {
        const parsedAmount = receiveAmount ? parseFloat(receiveAmount) : NaN;
        const amountSats =
          Number.isFinite(parsedAmount) && parsedAmount > 0
            ? Math.round(parsedAmount * 100_000_000)
            : undefined;
        const response = await payjoinApi.getPayjoinUri(
          selectedReceiveAddress.id ?? selectedReceiveAddress.address,
          amountSats ? { amount: amountSats } : undefined
        );
        setPayjoinUri(response.uri);
      } catch (err) {
        log.error('Failed to generate Payjoin URI', { error: err });
        setPayjoinUri(null);
      } finally {
        setPayjoinLoading(false);
      }
    };

    generatePayjoinUri();
  }, [payjoinEnabled, receiveAddress, selectedReceiveAddress, walletId, receiveAmount]);

  const handleClose = () => {
    setPayjoinEnabled(false);
    setPayjoinUri(null);
    setReceiveAmount('');
    setSelectedReceiveAddressId(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={handleClose}
    >
      <div
        className="surface-elevated rounded-xl max-w-md w-full p-6 shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 animate-modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-50">
            Receive Bitcoin
          </h3>
          <button
            onClick={handleClose}
            className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {receiveAddress ? (
          <div className="flex flex-col items-center">
            <div className="bg-white p-4 rounded-lg mb-4 shadow-sm">
              {payjoinLoading ? (
                <div className="w-[200px] h-[200px] flex items-center justify-center">
                  <RefreshCw className="w-8 h-8 animate-spin text-sanctuary-400" />
                </div>
              ) : (
                <QRCodeSVG value={displayValue} size={200} level="M" />
              )}
            </div>

            {/* Address Selector */}
            {selectedReceiveAddress && unusedReceiveAddresses.length > 1 && (
              <div className="w-full mb-4">
                <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                  Select Address ({unusedReceiveAddresses.length} unused)
                </label>
                <select
                  value={selectedReceiveAddress.id}
                  onChange={(e) => setSelectedReceiveAddressId(e.target.value || null)}
                  className="w-full px-3 py-2 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 surface-muted text-sm font-mono focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  {unusedReceiveAddresses.map((addr) => (
                    <option key={addr.id} value={addr.id}>
                      #{addr.index} - {addr.address.slice(0, 12)}...{addr.address.slice(-8)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Payjoin Section - only shown when feature flag is enabled */}
            {payjoinAvailable && (
              <PayjoinSection
                walletId={walletId}
                enabled={payjoinEnabled}
                onToggle={setPayjoinEnabled}
                className="w-full mb-4"
              />
            )}

            {/* Amount Input (optional, for BIP21) */}
            {payjoinAvailable && payjoinEnabled && (
              <div className="w-full mb-4">
                <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                  Amount (optional)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    step="0.00000001"
                    min="0"
                    value={receiveAmount}
                    onChange={(e) => setReceiveAmount(e.target.value)}
                    placeholder="0.00000000"
                    className="flex-1 px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 surface-muted text-sm font-mono"
                  />
                  <span className="text-sm text-sanctuary-500">BTC</span>
                </div>
              </div>
            )}

            <div className="w-full">
              <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                {payjoinEnabled ? 'BIP21 URI (with Payjoin)' : 'Receive Address'}
              </label>
              <div className="flex items-center space-x-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg p-3">
                <code className="text-xs font-mono text-sanctuary-700 dark:text-sanctuary-300 break-all flex-1">
                  {displayValue}
                </code>
                <button
                  onClick={() => copy(displayValue)}
                  className={`flex-shrink-0 p-2 rounded transition-colors ${
                    isCopied(displayValue)
                      ? 'bg-success-100 dark:bg-success-500/20 text-success-600 dark:text-success-400'
                      : 'hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 text-sanctuary-400'
                  }`}
                  title={isCopied(displayValue) ? 'Copied!' : 'Copy'}
                >
                  {isCopied(displayValue) ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <p className="text-xs text-sanctuary-500 mt-4 text-center">
              {payjoinEnabled
                ? 'Share this URI with a Payjoin-capable wallet for enhanced privacy.'
                : 'Send only Bitcoin (BTC) to this address.'}
            </p>
          </div>
        ) : fetchingAddress ? (
          <div className="flex flex-col items-center py-8">
            <RefreshCw className="w-8 h-8 animate-spin text-sanctuary-400 mb-4" />
            <p className="text-sanctuary-500">Loading receive address...</p>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-sanctuary-500 mb-4">
              No receive address available. Please link a hardware device with an xpub
              first.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                handleClose();
                onNavigateToSettings();
              }}
            >
              Go to Settings
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
