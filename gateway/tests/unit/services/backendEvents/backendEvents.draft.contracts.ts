import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockDeviceFetchResponse,
  push,
  setupBackendEventsTestHarness,
  startBackendEvents,
  wsInstances,
} from './backendEventsTestHarness';

describe('Backend Events Service draft notifications', () => {
  setupBackendEventsTestHarness();

  beforeEach(() => {
    mockDeviceFetchResponse();
  });

  it('should handle psbt_signing_required event', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'psbt_signing_required',
        walletId: 'wallet-1',
        walletName: 'Multisig Vault',
        userId: 'user-123',
        data: {
          draftId: 'draft-789',
          creatorName: 'Alice',
          amount: 100000000,
          requiredSignatures: 2,
          currentSignatures: 1,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatPsbtSigningNotification).toHaveBeenCalledWith(
      'Multisig Vault',
      'draft-789',
      'Alice',
      100000000,
      2,
      1
    );
    expect(push.sendToDevices).toHaveBeenCalled();
  });

  it('should handle draft_created event', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'draft_created',
        walletId: 'wallet-1',
        walletName: 'Business Wallet',
        userId: 'user-123',
        data: {
          draftId: 'draft-456',
          creatorName: 'Bob',
          amount: 50000000,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatDraftCreatedNotification).toHaveBeenCalledWith(
      'Business Wallet',
      'draft-456',
      'Bob',
      50000000
    );
    expect(push.sendToDevices).toHaveBeenCalled();
  });

  it('should handle draft_approved event', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'draft_approved',
        walletId: 'wallet-1',
        walletName: 'Vault',
        userId: 'user-123',
        data: {
          draftId: 'draft-111',
          signerName: 'Charlie',
          currentSignatures: 2,
          requiredSignatures: 2,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatDraftApprovedNotification).toHaveBeenCalledWith(
      'Vault',
      'draft-111',
      'Charlie',
      2,
      2
    );
    expect(push.sendToDevices).toHaveBeenCalled();
  });

  it('should not send psbt_signing_required without draftId or amount', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'psbt_signing_required',
        walletId: 'wallet-1',
        walletName: 'Vault',
        userId: 'user-123',
        data: {
          creatorName: 'Alice',
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatPsbtSigningNotification).not.toHaveBeenCalled();
    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should not send draft_created without draftId or amount', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'draft_created',
        walletId: 'wallet-1',
        walletName: 'Vault',
        userId: 'user-123',
        data: {
          creatorName: 'Bob',
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatDraftCreatedNotification).not.toHaveBeenCalled();
    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should not send draft_approved without draftId', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'draft_approved',
        walletId: 'wallet-1',
        walletName: 'Vault',
        userId: 'user-123',
        data: {
          signerName: 'Charlie',
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatDraftApprovedNotification).not.toHaveBeenCalled();
    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should use default wallet name when not provided', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'broadcast_success',
        walletId: 'wallet-1',
        userId: 'user-123',
        data: {
          txid: 'tx123',
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatBroadcastNotification).toHaveBeenCalledWith(
      true,
      'Wallet',
      'tx123'
    );
  });

  it('should use default creatorName when not provided for psbt_signing_required', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'psbt_signing_required',
        walletId: 'wallet-1',
        walletName: 'Vault',
        userId: 'user-123',
        data: {
          draftId: 'draft-123',
          amount: 100000,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatPsbtSigningNotification).toHaveBeenCalledWith(
      'Vault',
      'draft-123',
      'Someone',
      100000,
      2,
      1
    );
  });
});
