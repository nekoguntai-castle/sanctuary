import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../../src/api/labels', () => ({
  getLabels: vi.fn().mockResolvedValue([
    { id: 'lbl-1', walletId: 'w1', name: 'test', color: '#ff0000' },
  ]),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useWalletLabels', () => {
  it('exports a query hook that fetches labels for a wallet', async () => {
    const { useWalletLabels } = await import('../../../hooks/queries/useWalletLabels');
    const { result } = renderHook(() => useWalletLabels('w1'), { wrapper: createWrapper() });
    // Initially loading
    expect(result.current.isLoading).toBe(true);
  });
});
