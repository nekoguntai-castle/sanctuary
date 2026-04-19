import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import * as payjoinApi from '../../../src/api/payjoin';
import { createLogger } from '../../../utils/logger';
import type { Address } from '../../../types';
import type { ReceiveModalProps } from './receiveModalTypes';
import {
  getDisplayReceiveAddresses,
  getPayjoinAddressIdentifier,
  getPayjoinAvailable,
  getPayjoinUriOptions,
  getReceiveDisplayValue,
  getSelectedReceiveAddress,
  shouldFetchUnusedReceiveAddresses,
} from './receiveModalData';

const log = createLogger('ReceiveModal');

export function useReceiveModalState({
  walletId,
  addresses,
  onClose,
  onNavigateToSettings,
  onFetchUnusedAddresses,
}: ReceiveModalProps) {
  const { copy, isCopied } = useCopyToClipboard();
  const [fetchedAddresses, setFetchedAddresses] = useState<Address[]>([]);
  const [fetchingAddress, setFetchingAddress] = useState(false);
  const [selectedReceiveAddressId, setSelectedReceiveAddressId] = useState<string | null>(null);
  const [payjoinAvailable, setPayjoinAvailable] = useState(false);
  const [payjoinEnabled, setPayjoinEnabled] = useState(false);
  const [payjoinUri, setPayjoinUri] = useState<string | null>(null);
  const [payjoinLoading, setPayjoinLoading] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState('');
  const fetchAttemptedRef = useRef(false);

  const unusedReceiveAddresses = useMemo(
    () => getDisplayReceiveAddresses(addresses, fetchedAddresses),
    [addresses, fetchedAddresses]
  );
  const selectedReceiveAddress = useMemo(
    () => getSelectedReceiveAddress(unusedReceiveAddresses, selectedReceiveAddressId),
    [unusedReceiveAddresses, selectedReceiveAddressId]
  );
  const receiveAddress = selectedReceiveAddress?.address || '';
  const displayValue = getReceiveDisplayValue(payjoinUri, receiveAddress);

  useEffect(() => {
    const shouldFetch = shouldFetchUnusedReceiveAddresses(
      addresses,
      fetchAttemptedRef.current,
      Boolean(onFetchUnusedAddresses)
    );

    if (!shouldFetch || !onFetchUnusedAddresses) return;

    fetchAttemptedRef.current = true;
    setFetchingAddress(true);

    onFetchUnusedAddresses(walletId)
      .then(result => setFetchedAddresses(result))
      .catch(error => log.error('Failed to fetch unused receive address', { error }))
      .finally(() => setFetchingAddress(false));
  }, [walletId, addresses, onFetchUnusedAddresses]);

  useEffect(() => {
    const checkPayjoinStatus = async () => {
      try {
        const status = await payjoinApi.getPayjoinStatus();
        setPayjoinAvailable(getPayjoinAvailable(status));
      } catch (error) {
        log.debug('Failed to check payjoin status', { error });
        setPayjoinAvailable(false);
      }
    };

    void checkPayjoinStatus();
  }, []);

  useEffect(() => {
    if (!payjoinEnabled || !receiveAddress || !selectedReceiveAddress || !walletId) {
      setPayjoinUri(null);
      return;
    }

    let cancelled = false;

    const generatePayjoinUri = async () => {
      setPayjoinLoading(true);

      try {
        const response = await payjoinApi.getPayjoinUri(
          getPayjoinAddressIdentifier(selectedReceiveAddress),
          getPayjoinUriOptions(receiveAmount)
        );
        if (!cancelled) setPayjoinUri(response.uri);
      } catch (error) {
        log.error('Failed to generate Payjoin URI', { error });
        if (!cancelled) setPayjoinUri(null);
      } finally {
        if (!cancelled) setPayjoinLoading(false);
      }
    };

    void generatePayjoinUri();

    return () => {
      cancelled = true;
    };
  }, [payjoinEnabled, receiveAddress, selectedReceiveAddress, walletId, receiveAmount]);

  const handleClose = useCallback(() => {
    setPayjoinEnabled(false);
    setPayjoinUri(null);
    setReceiveAmount('');
    setSelectedReceiveAddressId(null);
    onClose();
  }, [onClose]);

  const handleNavigateToSettings = useCallback(() => {
    handleClose();
    onNavigateToSettings();
  }, [handleClose, onNavigateToSettings]);

  const handleCopy = useCallback(() => {
    copy(displayValue);
  }, [copy, displayValue]);

  return {
    unusedReceiveAddresses,
    selectedReceiveAddress,
    selectedReceiveAddressId,
    setSelectedReceiveAddressId,
    receiveAddress,
    displayValue,
    fetchingAddress,
    payjoinAvailable,
    payjoinEnabled,
    setPayjoinEnabled,
    payjoinUri,
    payjoinLoading,
    receiveAmount,
    setReceiveAmount,
    isCopied,
    handleCopy,
    handleClose,
    handleNavigateToSettings,
  };
}
