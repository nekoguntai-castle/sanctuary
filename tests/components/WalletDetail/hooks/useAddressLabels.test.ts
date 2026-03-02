import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAddressLabels } from '../../../../components/WalletDetail/hooks/useAddressLabels';
import * as labelsApi from '../../../../src/api/labels';
import { logError } from '../../../../utils/errorHandler';

vi.mock('../../../../src/api/labels', () => ({
  getLabels: vi.fn(),
  setAddressLabels: vi.fn(),
}));

vi.mock('../../../../utils/errorHandler', () => ({
  logError: vi.fn(),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useAddressLabels', () => {
  const setAddresses = vi.fn();
  const handleError = vi.fn();

  const renderAddressLabels = (walletId: string | undefined = 'wallet-1') =>
    renderHook(() =>
      useAddressLabels({
        walletId,
        setAddresses,
        handleError,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(labelsApi.getLabels).mockResolvedValue([
      { id: 'label-1', name: 'one' },
      { id: 'label-2', name: 'two' },
    ] as any);
    vi.mocked(labelsApi.setAddressLabels).mockResolvedValue(undefined as never);
  });

  it('guards edit when wallet/id are missing', async () => {
    const { result: noWallet } = renderHook(() =>
      useAddressLabels({
        walletId: undefined,
        setAddresses,
        handleError,
      })
    );
    await act(async () => {
      await noWallet.current.handleEditAddressLabels({ id: 'addr-1', labels: [] } as any);
    });
    expect(labelsApi.getLabels).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const { result: noId } = renderAddressLabels('wallet-1');
    await act(async () => {
      await noId.current.handleEditAddressLabels({ id: undefined, labels: [] } as any);
    });

    expect(labelsApi.getLabels).not.toHaveBeenCalled();
    expect(noWallet.current.editingAddressId).toBeNull();
    expect(noId.current.editingAddressId).toBeNull();
  });

  it('loads labels, handles selected-label fallback, and supports toggle/cancel', async () => {
    const { result } = renderAddressLabels('wallet-1');

    await act(async () => {
      await result.current.handleEditAddressLabels({
        id: 'addr-1',
        labels: [{ id: 'label-1' }],
      } as any);
    });
    expect(result.current.editingAddressId).toBe('addr-1');
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

  it('reports load/save failures via logError and handleError', async () => {
    vi.mocked(labelsApi.getLabels).mockRejectedValueOnce(new Error('load labels failed'));
    const { result } = renderAddressLabels('wallet-1');

    await act(async () => {
      await result.current.handleEditAddressLabels({
        id: 'addr-1',
        labels: [],
      } as any);
    });
    expect(logError).toHaveBeenCalledWith(expect.any(Object), expect.any(Error), 'Failed to load labels');
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Load Labels');

    vi.mocked(labelsApi.getLabels).mockResolvedValueOnce([{ id: 'label-1', name: 'one' }] as any);
    await act(async () => {
      await result.current.handleEditAddressLabels({
        id: 'addr-1',
        labels: [],
      } as any);
    });

    vi.mocked(labelsApi.setAddressLabels).mockRejectedValueOnce(new Error('save labels failed'));
    await act(async () => {
      await result.current.handleSaveAddressLabels();
    });
    expect(logError).toHaveBeenCalledWith(expect.any(Object), expect.any(Error), 'Failed to save address labels');
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Save Labels');
    expect(result.current.savingAddressLabels).toBe(false);
  });
});
