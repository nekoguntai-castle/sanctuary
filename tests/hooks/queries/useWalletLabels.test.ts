import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useWalletLabels,
  useCreateWalletLabel,
  useUpdateWalletLabel,
  useDeleteWalletLabel,
  useInvalidateWalletLabels,
  walletLabelKeys,
} from '../../../hooks/queries/useWalletLabels';

vi.mock('../../../src/api/labels', () => ({
  getLabels: vi.fn().mockResolvedValue([
    { id: 'lbl-1', walletId: 'w1', name: 'test', color: '#ff0000' },
  ]),
  createLabel: vi.fn().mockResolvedValue({ id: 'lbl-2', walletId: 'w1', name: 'new', color: '#00ff00' }),
  updateLabel: vi.fn().mockResolvedValue({ id: 'lbl-1', walletId: 'w1', name: 'updated', color: '#ff0000' }),
  deleteLabel: vi.fn().mockResolvedValue(undefined),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useWalletLabels', () => {
  it('fetches labels for a wallet', () => {
    const { result } = renderHook(() => useWalletLabels('w1'), { wrapper: createWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('exports query key factory', () => {
    expect(walletLabelKeys.detail('w1')).toEqual(['walletLabels', 'detail', 'w1']);
  });

  it('provides create mutation', () => {
    const { result } = renderHook(() => useCreateWalletLabel(), { wrapper: createWrapper() });
    expect(result.current.mutateAsync).toBeDefined();
    expect(result.current.isPending).toBe(false);
  });

  it('provides update mutation', () => {
    const { result } = renderHook(() => useUpdateWalletLabel(), { wrapper: createWrapper() });
    expect(result.current.mutateAsync).toBeDefined();
  });

  it('provides delete mutation', () => {
    const { result } = renderHook(() => useDeleteWalletLabel(), { wrapper: createWrapper() });
    expect(result.current.mutateAsync).toBeDefined();
  });

  it('provides invalidation callback', () => {
    const { result } = renderHook(() => useInvalidateWalletLabels(), { wrapper: createWrapper() });
    expect(typeof result.current).toBe('function');
  });
});
