import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWalletSelection } from '../../../src/components/Intelligence/IntelligenceShell/useWalletSelection';
import { WalletSelector } from '../../../src/components/Intelligence/IntelligenceShell/WalletSelector';

describe('useWalletSelection', () => {
  it('selects the first visible wallet and clears selection when none remain', () => {
    const wallets = [
      { id: 'wallet-1', name: 'Alpha', type: 'single_sig', balance: 0 },
      { id: 'wallet-2', name: 'Bravo', type: 'single_sig', balance: 0 },
    ] as any[];

    const { result, rerender } = renderHook(
      ({ visibleWallets }) => useWalletSelection(visibleWallets),
      { initialProps: { visibleWallets: wallets } }
    );

    expect(result.current.selectedWalletId).toBe('wallet-1');

    act(() => {
      result.current.selectWallet('wallet-2');
    });
    expect(result.current.selectedWalletId).toBe('wallet-2');

    rerender({ visibleWallets: [] });
    expect(result.current.selectedWalletId).toBe('');
  });

  it('toggles the dropdown and closes it on document click', () => {
    const wallets = [{ id: 'wallet-1', name: 'Alpha', type: 'single_sig', balance: 0 }] as any[];
    const { result, unmount } = renderHook(() => useWalletSelection(wallets));
    const stopPropagation = vi.fn();

    act(() => result.current.toggleDropdown({ stopPropagation } as any));
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(result.current.dropdownOpen).toBe(true);
    act(() => document.dispatchEvent(new MouseEvent('click')));
    expect(result.current.dropdownOpen).toBe(false);
    act(() => result.current.toggleDropdown({ stopPropagation } as any));
    unmount();
  });
});

describe('WalletSelector', () => {
  const wallets = [
    { id: 'wallet-1', name: 'Alpha', type: 'single_sig', balance: 0 },
    { id: 'wallet-2', name: 'Bravo', type: 'single_sig', balance: 0 },
  ] as any[];

  it('renders the closed placeholder and toggles', () => {
    const onToggle = vi.fn();
    render(<WalletSelector wallets={wallets} selectedWalletId="" dropdownOpen={false} onToggleDropdown={onToggle} onSelectWallet={vi.fn()} />);
    fireEvent.click(screen.getByText('Select wallet'));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.queryByText('Bravo')).not.toBeInTheDocument();
  });

  it('renders selections and distinguishes the selected wallet', () => {
    const onSelect = vi.fn();
    render(<WalletSelector wallets={wallets} selectedWallet={wallets[0]} selectedWalletId="wallet-1" dropdownOpen onToggleDropdown={vi.fn()} onSelectWallet={onSelect} />);
    expect(screen.getAllByText('Alpha')).toHaveLength(2);
    expect(screen.getAllByText('Alpha')[1].closest('button')).toHaveClass('font-medium');
    expect(screen.getByText('Bravo').closest('button')).not.toHaveClass('font-medium');
    fireEvent.click(screen.getByText('Bravo'));
    expect(onSelect).toHaveBeenCalledWith('wallet-2');
  });
});
