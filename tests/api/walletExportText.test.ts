import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_RETRY } from '../../src/api/retryPolicy';

const mockFetchBlob = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    fetchBlob: (...args: unknown[]) => mockFetchBlob(...args),
  },
}));

import { getWalletExportText } from '../../src/api/wallets';

describe('getWalletExportText', () => {
  beforeEach(() => {
    mockFetchBlob.mockReset();
  });

  it('fetches the server export once and returns its text', async () => {
    mockFetchBlob.mockResolvedValue(new Blob(['Name: Vault\nSorted: true\n']));
    const controller = new AbortController();

    const text = await getWalletExportText('w1', 'coldcard', controller.signal);

    expect(text).toBe('Name: Vault\nSorted: true\n');
    expect(mockFetchBlob).toHaveBeenCalledWith('/wallets/w1/export', {
      params: { format: 'coldcard' },
      retryOptions: NO_RETRY,
      signal: controller.signal,
    });
  });

  it('propagates server refusals', async () => {
    mockFetchBlob.mockRejectedValue(new Error('cannot export'));

    await expect(getWalletExportText('w1', 'coldcard')).rejects.toThrow('cannot export');
  });
});
