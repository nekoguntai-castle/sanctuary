/**
 * Non-regression tests for P2 `user-preference-write--user-keyed-effects-refetch`
 * (device list site) and its stale-reload race (D-13.B3c).
 *
 * Bug: the load effect keyed on the whole `user` object, so any preference
 * write reloaded the list; and `loadDevices` applied its result however old
 * the request was, so a reload that started before a delete or save resolved
 * put the deleted row back or reverted the saved label.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as devicesApi from '../../../src/api/devices';
import { useDeviceListRecords } from '../../../src/components/DeviceList/useDeviceListRecords';
import type { Device, User } from '../../../src/types';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../src/api/devices', () => ({
  getDevices: vi.fn(),
  getDeviceModels: vi.fn(),
  deleteDevice: vi.fn(),
  updateDevice: vi.fn(),
}));

const d1 = { id: 'd1', label: 'one' } as Device;
const d2 = { id: 'd2', label: 'two' } as Device;
const user = { id: 'u1', username: 'alice', isAdmin: false } as User;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

async function renderLoaded(initialUser: User = user) {
  const hook = renderHook(({ u }: { u: User | null }) => useDeviceListRecords(u), {
    initialProps: { u: initialUser },
  });
  await waitFor(() => expect(hook.result.current.devices).toHaveLength(2));
  return hook;
}

describe('useDeviceListRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(devicesApi.getDevices).mockResolvedValue([d1, d2]);
    vi.mocked(devicesApi.getDeviceModels).mockResolvedValue([]);
    vi.mocked(devicesApi.deleteDevice).mockResolvedValue(undefined);
  });

  it('discards a reload that started before a delete resolved', async () => {
    const { result } = await renderLoaded();
    const pending = deferred<Device[]>();
    vi.mocked(devicesApi.getDevices).mockReturnValueOnce(pending.promise);

    let reload!: Promise<unknown>;
    act(() => { reload = result.current.reload(); });
    await act(async () => { await result.current.handleDelete(d1); });
    expect(result.current.devices.map(d => d.id)).toEqual(['d2']);

    await act(async () => {
      pending.resolve([d1, d2]);
      await reload;
    });

    expect(result.current.devices.map(d => d.id)).toEqual(['d2']);
    expect(result.current.loading).toBe(false);
  });

  it('discards a reload that started before a save resolved', async () => {
    vi.mocked(devicesApi.updateDevice).mockResolvedValue({ ...d1, label: 'new' });
    const { result } = await renderLoaded();
    act(() => { result.current.handleEdit(d1); });
    act(() => { result.current.editState.setEditValue('new'); });
    const pending = deferred<Device[]>();
    vi.mocked(devicesApi.getDevices).mockReturnValueOnce(pending.promise);

    let reload!: Promise<unknown>;
    act(() => { reload = result.current.reload(); });
    await act(async () => { await result.current.handleSave(d1); });
    await act(async () => {
      pending.resolve([d1, d2]);
      await reload;
    });

    expect(result.current.devices.find(d => d.id === 'd1')?.label).toBe('new');
    expect(result.current.loading).toBe(false);
  });

  it('re-renders with a same-id user object without reloading', async () => {
    const { result, rerender } = await renderLoaded();
    rerender({ u: { ...user, preferences: { darkMode: true } } });
    await act(async () => { await Promise.resolve(); });

    expect(devicesApi.getDevices).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it('reloads when the user id changes', async () => {
    const { rerender } = await renderLoaded();
    rerender({ u: { ...user, id: 'u2' } });

    await waitFor(() => expect(devicesApi.getDevices).toHaveBeenCalledTimes(2));
  });
});
