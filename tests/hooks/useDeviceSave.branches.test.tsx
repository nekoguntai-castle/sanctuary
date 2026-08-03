import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

const mockNavigate = vi.fn();
const mockRefreshSidebar = vi.fn();
const mockCreateDeviceWithConflictHandling = vi.fn();
const mockMergeDeviceAccounts = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../src/contexts/SidebarContext', () => ({
  useSidebar: () => ({ refreshSidebar: mockRefreshSidebar }),
}));

vi.mock('../../src/api/devices', () => ({
  createDeviceWithConflictHandling: (request: unknown) => mockCreateDeviceWithConflictHandling(request),
  mergeDeviceAccounts: (request: unknown) => mockMergeDeviceAccounts(request),
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { useDeviceSave } from '../../src/hooks/useDeviceSave';

describe('useDeviceSave branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles legacy xpub save payload and unknown status without side effects', async () => {
    mockCreateDeviceWithConflictHandling.mockResolvedValue({ status: 'noop' });

    const { result } = renderHook(() => useDeviceSave());

    await act(async () => {
      await result.current.saveDevice({
        type: 'Coldcard Mk4',
        label: 'Legacy Device',
        fingerprint: 'ABCD1234',
        xpub: 'xpub-legacy',
        modelSlug: 'coldcard-mk4',
      } as any);
    });

    expect(mockCreateDeviceWithConflictHandling).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.conflictData).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockRefreshSidebar).not.toHaveBeenCalled();
  });

  it('sets fallback merge error message for non-Error rejections', async () => {
    mockMergeDeviceAccounts.mockRejectedValue('merge failed');

    const { result } = renderHook(() => useDeviceSave());

    await act(async () => {
      await result.current.mergeDevice({
        type: 'Coldcard Mk4',
        label: 'My Device',
        fingerprint: '12345678',
        accounts: [],
        modelSlug: 'coldcard-mk4',
      } as any);
    });

    expect(result.current.merging).toBe(false);
    expect(result.current.error).toBe('Failed to merge accounts. Please try again.');
  });
});
