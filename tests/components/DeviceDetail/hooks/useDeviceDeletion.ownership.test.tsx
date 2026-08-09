import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceDeletion } from '../../../../src/components/DeviceDetail/hooks/useDeviceDeletion';
import * as devicesApi from '../../../../src/api/devices';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../../../src/api/devices', () => ({ deleteDevice: vi.fn() }));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('useDeviceDeletion route ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not start deletion for an obsolete route handler', async () => {
    const { result } = renderHook(() => useDeviceDeletion({
      deviceId: 'A',
      attachedWalletCount: 0,
      isOwner: true,
      ownsCurrentRoute: () => false,
    }));

    await act(async () => result.current.confirmDelete());
    act(() => {
      result.current.requestDelete();
      result.current.cancelDelete();
    });

    expect(devicesApi.deleteDevice).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when an accepted deletion becomes stale', async () => {
    const deletion = createDeferred<void>();
    let ownsCurrentRoute = true;
    vi.mocked(devicesApi.deleteDevice).mockReturnValue(deletion.promise);
    const { result } = renderHook(() => useDeviceDeletion({
      deviceId: 'A',
      attachedWalletCount: 0,
      isOwner: true,
      ownsCurrentRoute: () => ownsCurrentRoute,
    }));

    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = result.current.confirmDelete();
    });
    ownsCurrentRoute = false;
    await act(async () => {
      deletion.resolve();
      await deletePromise;
    });

    expect(devicesApi.deleteDevice).toHaveBeenCalledWith('A');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not surface a deletion error after ownership changes', async () => {
    const deletion = createDeferred<void>();
    let ownsCurrentRoute = true;
    vi.mocked(devicesApi.deleteDevice).mockReturnValue(deletion.promise);
    const { result } = renderHook(() => useDeviceDeletion({
      deviceId: 'A',
      attachedWalletCount: 0,
      isOwner: true,
      ownsCurrentRoute: () => ownsCurrentRoute,
    }));

    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = result.current.confirmDelete();
    });
    ownsCurrentRoute = false;
    await act(async () => {
      deletion.reject(new Error('late deletion error'));
      await deletePromise;
    });

    expect(result.current.deleteError).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
