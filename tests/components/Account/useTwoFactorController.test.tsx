import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
