import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as twoFactorApi from '../../../src/api/twoFactor';
import { useTwoFactorController } from '../../../src/components/Account/Account/useTwoFactorController';

const context = vi.hoisted(() => ({ disable: vi.fn(), user: {twoFactorEnabled:true} as {twoFactorEnabled:boolean} | null }));
vi.mock('../../../src/contexts/UserContext', () => ({ useUser: () => ({ user: context.user, enableTwoFactor: vi.fn(), disableTwoFactor: context.disable }) }));

vi.mock('../../../src/api/twoFactor', () => ({
  setup2FA: vi.fn(),
  enable2FA: vi.fn(),
  disable2FA: vi.fn(),
  regenerateBackupCodes: vi.fn(),
}));

describe('useTwoFactorController - sensitive field reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.user = {twoFactorEnabled:true};
  });

  it('clears the shared password and regenerate token when the backup-codes modal is completed', async () => {
    const { result } = renderHook(() => useTwoFactorController());

    act(() => {
      result.current.setDisablePassword('super-secret');
      result.current.setRegenerateToken('123456');
    });

    await waitFor(() => expect(result.current.disablePassword).toBe('super-secret'));
    expect(result.current.regenerateToken).toBe('123456');

    act(() => {
      result.current.completeBackupCodes();
    });

    expect(result.current.disablePassword).toBe('');
    expect(result.current.regenerateToken).toBe('');
    expect(result.current.showBackupCodesModal).toBe(false);
    expect(result.current.backupCodes).toEqual([]);
  });
  it('reports disabled for a missing user at the controller boundary', () => {
    context.user = null;
    const { result } = renderHook(() => useTwoFactorController());
    expect(result.current.twoFactorEnabled).toBe(false);
  });

  it('retains one disable operation through duplicate admission and releases it for retry', async () => {
    let reject!: (error: Error) => void;
    context.disable.mockReturnValueOnce(new Promise((_resolve, no) => { reject = no; }));
    const { result } = renderHook(() => useTwoFactorController());
    act(() => {
      result.current.setDisablePassword('password');
      result.current.setDisableToken('123456');
    });
    let first!: Promise<void>;
    act(() => { first = result.current.disableTwoFactor(); });
    await act(async () => { await result.current.disableTwoFactor(); });
    expect(context.disable).toHaveBeenCalledTimes(1);
    expect(result.current.is2FALoading).toBe(true);
    await act(async () => { reject(new Error('current failure')); await first; });
    expect(result.current.is2FALoading).toBe(false);
    expect(result.current.twoFactorError).toBe('Failed to disable 2FA');
    context.disable.mockResolvedValueOnce({ success: true });
    await act(async () => { await result.current.disableTwoFactor(); });
    expect(context.disable).toHaveBeenCalledTimes(2);
    expect(result.current.disablePassword).toBe('');
  });

  it('guards startSetup and invalidates it when closeSetup is called in flight', async () => {
    let resolveSetup!: (value: { secret: string; qrCodeDataUrl: string }) => void;
    vi.mocked(twoFactorApi.setup2FA).mockReturnValueOnce(
      new Promise((resolve) => { resolveSetup = resolve; }),
    );
    const { result } = renderHook(() => useTwoFactorController());

    let firstSetup!: Promise<void>;
    act(() => { firstSetup = result.current.startSetup(); });
    // Duplicate startSetup while pending is ignored
    await act(async () => { await result.current.startSetup(); });
    expect(twoFactorApi.setup2FA).toHaveBeenCalledTimes(1);

    // Closing the setup modal invalidates the in-flight request
    act(() => { result.current.closeSetup(); });
    await act(async () => {
      resolveSetup({ secret: 'stale-secret', qrCodeDataUrl: 'data:image/png;base64,abc' });
      await firstSetup;
    });

    expect(result.current.showSetupModal).toBe(false);
    expect(result.current.setupData).toBeNull();

    // Also ignores a late startSetup rejection after closeSetup
    let rejectSetup!: (err: Error) => void;
    vi.mocked(twoFactorApi.setup2FA).mockReturnValueOnce(
      new Promise((_, reject) => { rejectSetup = reject; }),
    );
    let secondSetup!: Promise<void>;
    act(() => { secondSetup = result.current.startSetup(); });
    act(() => { result.current.closeSetup(); });
    await act(async () => {
      rejectSetup(new Error('late setup error'));
      await secondSetup;
    });
    expect(result.current.twoFactorError).toBeNull();
  });

  it('guards regenerateBackupCodes and invalidates it when closeBackupCodes is called in flight', async () => {
    let resolveRegen!: (value: { success: boolean; backupCodes: string[] }) => void;
    vi.mocked(twoFactorApi.regenerateBackupCodes).mockReturnValueOnce(
      new Promise((resolve) => { resolveRegen = resolve; }),
    );
    const { result } = renderHook(() => useTwoFactorController());
    act(() => {
      result.current.setDisablePassword('password');
      result.current.setRegenerateToken('123456');
    });

    let firstRegen!: Promise<void>;
    act(() => { firstRegen = result.current.regenerateBackupCodes(); });
    // Duplicate regenerate while pending is ignored
    await act(async () => { await result.current.regenerateBackupCodes(); });
    expect(twoFactorApi.regenerateBackupCodes).toHaveBeenCalledTimes(1);

    act(() => { result.current.closeBackupCodes(); });
    await act(async () => {
      resolveRegen({ success: true, backupCodes: ['stale-code'] });
      await firstRegen;
    });

    expect(result.current.backupCodes).toEqual([]);

    // Also ignores a late regenerateBackupCodes rejection after closeBackupCodes
    let rejectRegen!: (err: Error) => void;
    vi.mocked(twoFactorApi.regenerateBackupCodes).mockReturnValueOnce(
      new Promise((_, reject) => { rejectRegen = reject; }),
    );
    act(() => {
      result.current.setDisablePassword('password');
      result.current.setRegenerateToken('123456');
    });
    let secondRegen!: Promise<void>;
    act(() => { secondRegen = result.current.regenerateBackupCodes(); });
    act(() => { result.current.closeBackupCodes(); });
    await act(async () => {
      rejectRegen(new Error('late regen error'));
      await secondRegen;
    });
    expect(result.current.twoFactorError).toBeNull();
  });

  it('invalidates an in-flight disable request when closeDisable is called', async () => {
    let rejectDisable!: (error: Error) => void;
    context.disable.mockReturnValueOnce(
      new Promise((_resolve, reject) => { rejectDisable = reject; }),
    );
    const { result } = renderHook(() => useTwoFactorController());
    act(() => {
      result.current.setDisablePassword('password');
      result.current.setDisableToken('123456');
    });

    let pendingDisable!: Promise<void>;
    act(() => { pendingDisable = result.current.disableTwoFactor(); });
    act(() => { result.current.closeDisable(); });

    await act(async () => {
      rejectDisable(new Error('late error'));
      await pendingDisable;
    });

    expect(result.current.twoFactorError).toBeNull();
    expect(result.current.is2FALoading).toBe(false);
  });
});
