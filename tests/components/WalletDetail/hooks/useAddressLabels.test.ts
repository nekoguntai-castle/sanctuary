import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useAddressLabels } from '../../../../components/WalletDetail/hooks/useAddressLabels';
import * as labelsApi from '../../../../src/api/labels';
import type { Label } from '../../../../types';

vi.mock('../../../../src/api/labels', () => ({
  setAddressLabels: vi.fn(),
}));

describe('useAddressLabels', () => {
  const setAddresses = vi.fn();
  const handleError = vi.fn();

  const mockLabels: Label[] = [
    { id: 'label-1', walletId: 'wallet-1', name: 'one', color: '#111', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'label-2', walletId: 'wallet-1', name: 'two', color: '#222', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ];

  const renderAddressLabels = (walletId: string | undefined = 'wallet-1', walletLabels: Label[] = mockLabels) =>
    renderHook(() =>
      useAddressLabels({
        walletId,
        walletLabels,
        setAddresses,
        handleError,
      })
    );

  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, reject, resolve };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(labelsApi.setAddressLabels).mockResolvedValue(undefined as never);
  });

  it('guards edit when wallet/id are missing', async () => {
    const { result: noWallet } = renderHook(() =>
      useAddressLabels({
        walletId: undefined,
        walletLabels: mockLabels,
        setAddresses,
        handleError,
      })
    );
    await act(async () => {
      await noWallet.current.handleEditAddressLabels({ id: 'addr-1', labels: [] } as any);
    });
    // Should not set editingAddressId when walletId is missing
    expect(noWallet.current.editingAddressId).toBeNull();

    vi.clearAllMocks();
    const { result: noId } = renderAddressLabels('wallet-1');
    await act(async () => {
      await noId.current.handleEditAddressLabels({ id: undefined, labels: [] } as any);
    });

    // Should not set editingAddressId when address id is missing
    expect(noId.current.editingAddressId).toBeNull();
  });

  it('reads walletLabels, handles selected-label fallback, and supports toggle/cancel', async () => {
    const { result } = renderAddressLabels('wallet-1');

    await act(async () => {
      await result.current.handleEditAddressLabels({
        id: 'addr-1',
        labels: [{ id: 'label-1' }],
      } as any);
    });
    expect(result.current.editingAddressId).toBe('addr-1');
    // availableLabels comes from walletLabels prop, not from API call
    expect(result.current.availableLabels).toHaveLength(2);
    expect(result.current.selectedLabelIds).toEqual(['label-1']);

    await act(async () => {
      await result.current.handleEditAddressLabels({
        id: 'addr-2',
      } as any);
    });
    expect(result.current.selectedLabelIds).toEqual([]);

    act(() => {
      result.current.handleToggleAddressLabel('label-2');
    });
    expect(result.current.selectedLabelIds).toEqual(['label-2']);

    act(() => {
      result.current.handleToggleAddressLabel('label-2');
    });
    expect(result.current.selectedLabelIds).toEqual([]);

    act(() => {
      result.current.handleCancelEditLabels();
    });
    expect(result.current.editingAddressId).toBeNull();
  });

  it('guards save without edit and updates local addresses on successful save', async () => {
    const { result } = renderAddressLabels('wallet-1');

    await act(async () => {
      await result.current.handleSaveAddressLabels();
    });
    expect(labelsApi.setAddressLabels).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleEditAddressLabels({
        id: 'addr-1',
        labels: [{ id: 'label-1' }],
      } as any);
    });
    act(() => {
      result.current.handleToggleAddressLabel('label-2');
    });

    await act(async () => {
      await result.current.handleSaveAddressLabels();
    });

    expect(labelsApi.setAddressLabels).toHaveBeenCalledWith('addr-1', ['label-1', 'label-2']);
    expect(setAddresses).toHaveBeenCalledTimes(1);

    const updater = setAddresses.mock.calls[0][0];
    const updated = updater([
      { id: 'addr-1', labels: [] },
      { id: 'addr-2', labels: [{ id: 'old' }] },
    ]);
    expect(updated[0].labels.map((l: { id: string }) => l.id)).toEqual(['label-1', 'label-2']);
    expect(updated[1].labels.map((l: { id: string }) => l.id)).toEqual(['old']);
    expect(result.current.editingAddressId).toBeNull();
    expect(result.current.savingAddressLabels).toBe(false);
  });

  it('reports save failures via handleError', async () => {
    const { result } = renderAddressLabels('wallet-1');

    // Start editing to set editingAddressId
    await act(async () => {
      await result.current.handleEditAddressLabels({
        id: 'addr-1',
        labels: [],
      } as any);
    });
    expect(result.current.editingAddressId).toBe('addr-1');

    vi.mocked(labelsApi.setAddressLabels).mockRejectedValueOnce(new Error('save labels failed'));
    await act(async () => {
      await result.current.handleSaveAddressLabels();
    });
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), expect.stringContaining('addr-1'));
    expect(result.current.savingAddressLabels).toBe(false);
  });

  it('uses the address id in save errors when the display address is unavailable', async () => {
    const { result } = renderAddressLabels('wallet-1');
    await act(async () => {
      await result.current.handleEditAddressLabels({ id: 'addr-fallback', labels: [] } as any);
    });
    vi.mocked(labelsApi.setAddressLabels).mockRejectedValueOnce(new Error('save labels failed'));

    await act(async () => {
      await result.current.handleSaveAddressLabels();
    });

    expect(handleError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringContaining('addr-fallback'),
    );
  });

  it('omits selected label ids that are absent from the captured label snapshot', async () => {
    const { result } = renderAddressLabels('wallet-1');
    await act(async () => {
      await result.current.handleEditAddressLabels({
        id: 'addr-1',
        address: 'bc1-address',
        labels: [],
      } as any);
      result.current.handleToggleAddressLabel('missing-label');
    });

    await act(async () => {
      await result.current.handleSaveAddressLabels();
    });

    const updater = setAddresses.mock.calls[0][0];
    expect(updater([{ id: 'addr-1', labels: [mockLabels[0]] }])[0].labels).toEqual([]);
  });

  it.each(['success', 'failure'] as const)(
    'keeps B editor ownership when stale save A settles with %s',
    async (outcome) => {
      const saveA = deferred<Label[]>();
      const saveB = deferred<Label[]>();
      vi.mocked(labelsApi.setAddressLabels)
        .mockReturnValueOnce(saveA.promise)
        .mockReturnValueOnce(saveB.promise);
      const { result } = renderAddressLabels();
      const addressA = { id: 'addr-a', address: 'bc1-address-a', labels: [mockLabels[0]] } as any;
      const addressB = { id: 'addr-b', address: 'bc1-address-b', labels: [] } as any;

      await act(async () => result.current.handleEditAddressLabels(addressA));
      let promiseA!: Promise<void>;
      act(() => { promiseA = result.current.handleSaveAddressLabels(); });
      await act(async () => {
        await result.current.handleEditAddressLabels(addressB);
        result.current.handleToggleAddressLabel('label-2');
      });
      let promiseB!: Promise<void>;
      act(() => { promiseB = result.current.handleSaveAddressLabels(); });
      expect(result.current.editingAddressId).toBe('addr-b');
      expect(result.current.savingAddressLabels).toBe(true);

      await act(async () => {
        if (outcome === 'success') saveA.resolve([mockLabels[0]]);
        else saveA.reject(new Error('A failed'));
        await promiseA;
      });

      expect(result.current.editingAddressId).toBe('addr-b');
      expect(result.current.savingAddressLabels).toBe(true);
      if (outcome === 'success') {
        expect(setAddresses).toHaveBeenCalledTimes(1);
      } else {
        expect(setAddresses).not.toHaveBeenCalled();
        expect(handleError).toHaveBeenCalledWith(
          expect.any(Error),
          expect.stringContaining('bc1-address-a'),
        );
      }

      await act(async () => {
        saveB.resolve([mockLabels[1]]);
        await promiseB;
      });
      expect(result.current.editingAddressId).toBeNull();
      expect(result.current.savingAddressLabels).toBe(false);
    },
  );

  it.each(['success', 'failure'] as const)(
    'keeps settled B state when save A finishes later with %s',
    async (outcome) => {
      const saveA = deferred<Label[]>();
      const saveB = deferred<Label[]>();
      vi.mocked(labelsApi.setAddressLabels)
        .mockReturnValueOnce(saveA.promise)
        .mockReturnValueOnce(saveB.promise);
      const { result } = renderAddressLabels();
      const addressA = { id: 'addr-a', address: 'bc1-address-a', labels: [mockLabels[0]] } as any;
      const addressB = { id: 'addr-b', address: 'bc1-address-b', labels: [mockLabels[1]] } as any;

      await act(async () => result.current.handleEditAddressLabels(addressA));
      let promiseA!: Promise<void>;
      act(() => { promiseA = result.current.handleSaveAddressLabels(); });
      await act(async () => result.current.handleEditAddressLabels(addressB));
      let promiseB!: Promise<void>;
      act(() => { promiseB = result.current.handleSaveAddressLabels(); });
      await act(async () => {
        saveB.resolve([mockLabels[1]]);
        await promiseB;
      });
      expect(result.current.editingAddressId).toBeNull();
      expect(result.current.savingAddressLabels).toBe(false);

      await act(async () => {
        if (outcome === 'success') saveA.resolve([mockLabels[0]]);
        else saveA.reject(new Error('late A failed'));
        await promiseA;
      });
      expect(result.current.editingAddressId).toBeNull();
      expect(result.current.savingAddressLabels).toBe(false);
      if (outcome === 'success') {
        expect(setAddresses).toHaveBeenCalledTimes(2);
      } else {
        expect(handleError).toHaveBeenCalledWith(
          expect.any(Error),
          expect.stringContaining('bc1-address-a'),
        );
      }
    },
  );

  it('patches only captured A labels and preserves refreshed fields after cancel', async () => {
    const save = deferred<Label[]>();
    vi.mocked(labelsApi.setAddressLabels).mockReturnValueOnce(save.promise);
    const { result } = renderAddressLabels();
    const addressA = {
      id: 'addr-a',
      address: 'bc1-address-a',
      labels: [mockLabels[0]],
      balance: 10,
      used: false,
    } as any;

    await act(async () => result.current.handleEditAddressLabels(addressA));
    let savePromise!: Promise<void>;
    act(() => { savePromise = result.current.handleSaveAddressLabels(); });
    act(() => result.current.handleCancelEditLabels());
    await act(async () => {
      save.resolve([mockLabels[0]]);
      await savePromise;
    });

    expect(result.current.editingAddressId).toBeNull();
    expect(result.current.savingAddressLabels).toBe(false);
    const updater = setAddresses.mock.calls[0][0];
    expect(updater([{ ...addressA, balance: 999, used: true }])[0]).toMatchObject({
      id: 'addr-a',
      balance: 999,
      used: true,
      labels: [mockLabels[0]],
    });
  });

  it('suppresses old-wallet completion UI work after wallet change', async () => {
    const save = deferred<Label[]>();
    vi.mocked(labelsApi.setAddressLabels).mockReturnValueOnce(save.promise);
    const { result, rerender } = renderHook(
      ({ walletId }) => useAddressLabels({ walletId, walletLabels: mockLabels, setAddresses, handleError }),
      { initialProps: { walletId: 'wallet-a' } },
    );
    await act(async () => result.current.handleEditAddressLabels({
      id: 'addr-a', address: 'bc1-address-a', labels: [],
    } as any));
    let savePromise!: Promise<void>;
    act(() => { savePromise = result.current.handleSaveAddressLabels(); });
    rerender({ walletId: 'wallet-b' });

    await act(async () => {
      save.reject(new Error('old wallet failed'));
      await savePromise;
    });

    expect(result.current.editingAddressId).toBeNull();
    expect(result.current.savingAddressLabels).toBe(false);
    expect(setAddresses).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
  });

  it('suppresses completion UI work after unmount', async () => {
    const save = deferred<Label[]>();
    vi.mocked(labelsApi.setAddressLabels).mockReturnValueOnce(save.promise);
    const { result, unmount } = renderAddressLabels();
    await act(async () => result.current.handleEditAddressLabels({
      id: 'addr-a', address: 'bc1-address-a', labels: [],
    } as any));
    let savePromise!: Promise<void>;
    act(() => { savePromise = result.current.handleSaveAddressLabels(); });
    unmount();
    await act(async () => {
      save.resolve([]);
      await savePromise;
    });
    expect(setAddresses).not.toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
  });
});
