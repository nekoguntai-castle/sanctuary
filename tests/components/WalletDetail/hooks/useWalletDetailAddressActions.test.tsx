import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWalletDetailAddressActions } from '../../../../src/components/WalletDetail/hooks/useWalletDetailAddressActions';

describe('useWalletDetailAddressActions', () => {
  it('does not generate addresses before a wallet route is available', async () => {
    const loadAddresses = vi.fn();
    const loadAddressSummary = vi.fn();
    const handleError = vi.fn();
    const { result } = renderHook(() => useWalletDetailAddressActions({
      walletId: undefined,
      loadingAddresses: false,
      hasMoreAddresses: false,
      loadAddresses,
      loadAddressSummary,
      addressOffset: 0,
      addressPageSize: 25,
      handleError,
    }));

    await act(async () => result.current.handleGenerateMoreAddresses());

    expect(loadAddressSummary).not.toHaveBeenCalled();
    expect(loadAddresses).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
  });
});
