import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTwoFactorController } from '../../../src/components/Account/Account/useTwoFactorController';

vi.mock('../../../src/api/twoFactor', () => ({
  setup2FA: vi.fn(),
  enable2FA: vi.fn(),
  disable2FA: vi.fn(),
  regenerateBackupCodes: vi.fn(),
}));

describe('useTwoFactorController - sensitive field reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the shared password and regenerate token when the backup-codes modal is completed', async () => {
    const { result } = renderHook(() => useTwoFactorController(true));

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
});
