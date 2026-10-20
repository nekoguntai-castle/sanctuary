import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshWalletAndDeviceLists } from '../../../src/hooks/queries/entityCaches';
import { deviceKeys } from '../../../src/hooks/queries/deviceKeys';
import { walletKeys } from '../../../src/hooks/queries/walletKeys';

const mockQc = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock('../../../src/providers/QueryProvider', () => ({ getQueryClient: () => mockQc }));

describe('refreshWalletAndDeviceLists', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('invalidates both the wallet and device lists', () => {
    refreshWalletAndDeviceLists();
    expect(mockQc.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockQc.invalidateQueries).toHaveBeenCalledWith({ queryKey: walletKeys.lists() });
    expect(mockQc.invalidateQueries).toHaveBeenCalledWith({ queryKey: deviceKeys.lists() });
  });
});
