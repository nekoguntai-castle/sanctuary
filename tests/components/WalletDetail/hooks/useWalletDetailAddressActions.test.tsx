import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as transactionsApi from '../../../../src/api/transactions';
import { useWalletDetailAddressActions } from '../../../../src/components/WalletDetail/hooks/useWalletDetailAddressActions';

vi.mock('../../../../src/api/transactions', () => ({
  generateAddresses: vi.fn(),
  getAddresses: vi.fn(),
}));

const mockLogError = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/utils/errorHandler', () => ({
  logError: mockLogError,
}));

const createParams = (overrides: Record<string, unknown> = {}) => ({
  walletId: 'wallet-1',
  loadingAddresses: false,
  hasMoreAddresses: true,
  loadAddresses: vi.fn().mockResolvedValue(undefined),
  addressOffset: 25,
  addressPageSize: 25,
  handleError: vi.fn(),
  ...overrides,
});

describe('useWalletDetailAddressActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { walletId: undefined },
    { loadingAddresses: true },
    { hasMoreAddresses: false },
  ])('refuses unavailable load-more state %#', async (override) => {
    const params = createParams(override);
    const { result } = renderHook(() => useWalletDetailAddressActions(params));
    await act(async () => result.current.handleLoadMoreAddressPage());
    expect(params.loadAddresses).not.toHaveBeenCalled();
  });

  it('loads the owned next page', async () => {
    const params = createParams();
    const { result } = renderHook(() => useWalletDetailAddressActions(params));
    await act(async () => result.current.handleLoadMoreAddressPage());
    expect(params.loadAddresses).toHaveBeenCalledWith('wallet-1', 25, 25, false);
  });

  it('generates addresses and delegates one reset replacement', async () => {
    vi.mocked(transactionsApi.generateAddresses).mockResolvedValue(undefined as never);
    const params = createParams();
    const { result } = renderHook(() => useWalletDetailAddressActions(params));
    await act(async () => result.current.handleGenerateMoreAddresses());
    expect(transactionsApi.generateAddresses).toHaveBeenCalledWith('wallet-1', 10);
    expect(params.loadAddresses).toHaveBeenCalledWith('wallet-1', 25, 0, true);
  });

  it('does not generate without a wallet and reports generation failures', async () => {
    const missing = createParams({ walletId: undefined });
    const first = renderHook(() => useWalletDetailAddressActions(missing));
    await act(async () => first.result.current.handleGenerateMoreAddresses());
    expect(transactionsApi.generateAddresses).not.toHaveBeenCalled();
    first.unmount();

    const failure = new Error('generation failed');
    vi.mocked(transactionsApi.generateAddresses).mockRejectedValueOnce(failure);
    const params = createParams();
    const second = renderHook(() => useWalletDetailAddressActions(params));
    await act(async () => second.result.current.handleGenerateMoreAddresses());
    expect(mockLogError).toHaveBeenCalledWith(expect.anything(), failure, 'Failed to generate more addresses');
    expect(params.handleError).toHaveBeenCalledWith(failure, 'Failed to Generate Addresses');
  });

  it('returns existing unused addresses without generation', async () => {
    const unused = [{ address: 'bc1qunused' }];
    vi.mocked(transactionsApi.getAddresses).mockResolvedValueOnce(unused as never);
    const params = createParams();
    const { result } = renderHook(() => useWalletDetailAddressActions(params));
    await expect(result.current.handleFetchUnusedAddresses('wallet-1')).resolves.toEqual(unused);
    expect(transactionsApi.generateAddresses).not.toHaveBeenCalled();
  });

  it('generates and refetches when no unused address exists', async () => {
    const generated = [{ address: 'bc1qgenerated' }];
    vi.mocked(transactionsApi.getAddresses)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(generated as never);
    const params = createParams();
    const { result } = renderHook(() => useWalletDetailAddressActions(params));
    await expect(result.current.handleFetchUnusedAddresses('wallet-1')).resolves.toEqual(generated);
    expect(transactionsApi.generateAddresses).toHaveBeenCalledWith('wallet-1', 10);
  });
});
