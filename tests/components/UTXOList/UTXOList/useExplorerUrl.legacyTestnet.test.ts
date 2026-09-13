import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useExplorerUrl } from '../../../../src/components/UTXOList/UTXOList/useExplorerUrl';

/**
 * Unlike useExplorerUrl.test.ts, this file does NOT mock `src/api/bitcoin` —
 * it mocks the HTTP boundary (`src/api/client`) instead, so the real
 * `bitcoinApi.getStatus` runs and its legacy-network normalization is
 * observable on the outgoing request.
 *
 * Regression: the hook forwarded `network` to `getStatus` via
 * `as Parameters<typeof bitcoinApi.getStatus>[0]`, a cast (#1067) that
 * silenced the type error which would have caught a legacy 'testnet' wallet
 * network reaching `/bitcoin/status` unnormalized (a 400).
 */
const mockGet = vi.fn();

vi.mock('../../../../src/api/client', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

describe('useExplorerUrl with a legacy testnet network', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({ connected: true, explorerUrl: 'https://explorer.example/testnet3' });
  });

  it('requests the testnet3 explorer when the wallet network is the legacy "testnet"', async () => {
    const { result } = renderHook(() => useExplorerUrl('testnet'));

    await waitFor(() => {
      expect(result.current).toBe('https://explorer.example/testnet3');
    });

    expect(mockGet).toHaveBeenCalledWith('/bitcoin/status', { network: 'testnet3' });
  });
});
