import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { WalletOption, WalletSelectionController } from './types';

export function useWalletSelection(wallets: WalletOption[]): WalletSelectionController {
  const [selectedWalletId, setSelectedWalletId] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (wallets.length > 0 && !selectedWalletId) {
      setSelectedWalletId(wallets[0].id);
    }
  }, [wallets, selectedWalletId]);

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
    setSelectedWalletId(walletId);
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
