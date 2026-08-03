import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWalletSelection } from '../../../src/components/Intelligence/IntelligenceShell/useWalletSelection';

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
});
