import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTransactionList } from '../../../src/components/TransactionList/hooks/useTransactionList';

/**
 * Unlike useTransactionList.branches.test.tsx, this file does NOT mock
 * `src/api/bitcoin` — it mocks the HTTP boundary (`src/api/client`) instead,
 * so the real `bitcoinApi.getStatus` runs and its legacy-network
 * normalization is observable on the outgoing request.
 *
 * Regression: the hook forwarded `network` to `getStatus` via
 * `as Parameters<typeof bitcoinApi.getStatus>[0]`, a cast (#1067) that
 * silenced the type error which would have caught a legacy 'testnet' wallet
 * network reaching `/bitcoin/status` unnormalized (a 400).
 */
const mockGet = vi.fn();

vi.mock('../../../src/api/client', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useTransactionList with a legacy testnet network', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({ connected: true, explorerUrl: 'https://explorer.example/testnet3' });
  });

  it('requests the testnet3 explorer when the active network is the legacy "testnet"', async () => {
    renderHook(() => useTransactionList({ transactions: [], network: 'testnet' }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/bitcoin/status', { network: 'testnet3' });
    });
  });
});
