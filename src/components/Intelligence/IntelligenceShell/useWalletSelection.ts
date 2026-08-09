import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { WalletOption, WalletSelectionController } from './types';

export function useWalletSelection(wallets: WalletOption[]): WalletSelectionController {
  const [storedWalletId, setStoredWalletId] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const selectedWalletId = wallets.some((wallet) => wallet.id === storedWalletId)
    ? storedWalletId
    : (wallets[0]?.id ?? '');

  useEffect(() => {
    if (storedWalletId !== selectedWalletId) setStoredWalletId(selectedWalletId);
  }, [selectedWalletId, storedWalletId]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = () => setDropdownOpen(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [dropdownOpen]);

  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.id === selectedWalletId),
    [wallets, selectedWalletId]
  );

  const toggleDropdown = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setDropdownOpen((prev) => !prev);
  }, []);

  const selectWallet = useCallback((walletId: string) => {
    setStoredWalletId(walletId);
    setDropdownOpen(false);
  }, []);

  return {
    selectedWalletId,
    selectedWallet,
    dropdownOpen,
    toggleDropdown,
    selectWallet,
  };
}
