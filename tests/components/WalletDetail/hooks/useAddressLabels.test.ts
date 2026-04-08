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
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Save Labels');
    expect(result.current.savingAddressLabels).toBe(false);
  });
});
