import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDownload = vi.fn();

vi.mock('../../../src/api/client', () => ({
  default: {
    download: (...args: unknown[]) => mockDownload(...args),
  },
}));

import { downloadSupportPackage } from '../../../src/api/admin/supportPackage';

describe('downloadSupportPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls apiClient.download with POST method', async () => {
    mockDownload.mockResolvedValue(undefined);

    await downloadSupportPackage();

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledWith(
      '/admin/support-package',
      undefined,
      { method: 'POST', body: { confirmShareableAggregate: true } }
    );
  });

  it('propagates errors from apiClient.download', async () => {
    mockDownload.mockRejectedValue(new Error('Network error'));

    await expect(downloadSupportPackage()).rejects.toThrow('Network error');
  });
});
