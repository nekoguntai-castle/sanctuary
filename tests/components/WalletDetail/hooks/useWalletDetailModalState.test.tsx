import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { useWalletDetailModalState } from '../../../../src/components/WalletDetail/hooks/useWalletDetailModalState';
import * as walletsApi from '../../../../src/api/wallets';
import { walletKeys } from '../../../../src/hooks/queries/walletKeys';

const qc = vi.hoisted(() => ({ current: null as unknown as QueryClient }));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../../src/api/wallets', () => ({ deleteWallet: vi.fn() }));
vi.mock('../../../../src/providers/QueryProvider', () => ({ getQueryClient: () => qc.current }));

const navigate = vi.fn();
const handleError = vi.fn();

function renderState() {
  return renderHook(() => useWalletDetailModalState({
    walletId: 'A',
    ownershipKey: 'A:user:mainnet',
    navigate,
    handleError,
    handleTransferComplete: vi.fn() as never,
    setActiveTab: vi.fn(),
  }));
}

describe('Wallet delete cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qc.current = new QueryClient();
    qc.current.setQueryData(walletKeys.lists(), [{ id: 'A' }]);
    qc.current.setQueryData(walletKeys.detail('A'), { id: 'A' });
  });

  it('removes the deleted wallet detail, refreshes the list and navigates away', async () => {
    vi.mocked(walletsApi.deleteWallet).mockResolvedValueOnce(undefined as never);
    const view = renderState();
    act(() => view.result.current.openDelete());
    await act(async () => { await view.result.current.handleConfirmDelete(); });
    expect(qc.current.getQueryData(walletKeys.detail('A'))).toBeUndefined();
    expect(qc.current.getQueryState(walletKeys.lists())?.isInvalidated).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/wallets');
  });

  it('keeps the caches and reports the error when the delete is rejected', async () => {
    vi.mocked(walletsApi.deleteWallet).mockRejectedValueOnce(new Error('denied'));
    const view = renderState();
    act(() => view.result.current.openDelete());
    await act(async () => { await view.result.current.handleConfirmDelete(); });
    expect(qc.current.getQueryData(walletKeys.detail('A'))).toEqual({ id: 'A' });
    expect(qc.current.getQueryState(walletKeys.lists())?.isInvalidated).toBe(false);
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Delete Failed');
  });
});
