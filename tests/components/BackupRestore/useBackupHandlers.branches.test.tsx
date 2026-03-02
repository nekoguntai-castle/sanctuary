import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackupHandlers } from '../../../components/BackupRestore/hooks/useBackupHandlers';
import * as adminApi from '../../../src/api/admin';

const notificationSpies = vi.hoisted(() => ({
  addNotification: vi.fn(),
}));

const downloadSpies = vi.hoisted(() => ({
  downloadText: vi.fn(),
  downloadBlob: vi.fn(),
}));

const loggerSpies = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/api/admin', () => ({
  createBackup: vi.fn(),
  validateBackup: vi.fn(),
  restoreBackup: vi.fn(),
}));

vi.mock('../../../contexts/AppNotificationContext', () => ({
  useAppNotifications: () => notificationSpies,
}));

vi.mock('../../../utils/download', () => ({
  downloadText: (...args: unknown[]) => downloadSpies.downloadText(...args),
  downloadBlob: (...args: unknown[]) => downloadSpies.downloadBlob(...args),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

const encryptionKeys = {
  encryptionKey: 'enc-key-1',
  encryptionSalt: 'enc-salt-1',
  hasEncryptionKey: true,
  hasEncryptionSalt: true,
};

const validBackupJson = JSON.stringify({ version: '1.0.0', data: { wallets: [] } });

const makeFile = (contents: string, name = 'backup.json') => ({
  name,
  text: vi.fn().mockResolvedValue(contents),
}) as unknown as File;

describe('useBackupHandlers branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();

    vi.mocked(adminApi.createBackup).mockResolvedValue(new Blob(['{}']) as never);
    vi.mocked(adminApi.validateBackup).mockResolvedValue({ valid: true, warnings: [] } as never);
    vi.mocked(adminApi.restoreBackup).mockResolvedValue({ success: true, warnings: ['warn-a'] } as never);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('covers no-encryption-keys and dismiss-without-persist branches', () => {
    const { result } = renderHook(() => useBackupHandlers(null));

    act(() => {
      result.current.downloadEncryptionKeys();
      result.current.dismissBackupCompleteModal();
    });

    expect(downloadSpies.downloadText).not.toHaveBeenCalled();
    expect(localStorage.getItem('sanctuary_backup_modal_dismissed')).toBeNull();
  });

  it('covers create backup success path and non-Error fallback message', async () => {
    localStorage.setItem('sanctuary_backup_modal_dismissed', 'true');

    const { result } = renderHook(() => useBackupHandlers(encryptionKeys));

    act(() => {
      result.current.setIncludeCache(true);
      result.current.setDescription('  nightly snapshot  ');
    });

    await act(async () => {
      await result.current.handleCreateBackup();
    });

    expect(adminApi.createBackup).toHaveBeenCalledWith({
      includeCache: true,
      description: 'nightly snapshot',
    });
    expect(downloadSpies.downloadBlob).toHaveBeenCalledOnce();
    expect(result.current.backupSuccess).toBe(true);

    vi.mocked(adminApi.createBackup).mockRejectedValueOnce('nope' as never);
    await act(async () => {
      await result.current.handleCreateBackup();
    });

    expect(result.current.backupError).toBe('Failed to create backup');
  });

  it('covers file-upload guard and parse-error reset path', async () => {
    const { result } = renderHook(() => useBackupHandlers(encryptionKeys));

    await act(async () => {
      await result.current.handleFileUpload({
        target: { files: [] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });
    expect(adminApi.validateBackup).not.toHaveBeenCalled();

    result.current.fileInputRef.current = { value: 'stale' } as HTMLInputElement;

    await act(async () => {
      await result.current.handleFileUpload({
        target: { files: [makeFile('not-json', 'bad.json')] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.restoreError).toContain('Invalid backup file format');
    expect(result.current.fileInputRef.current?.value).toBe('');
  });

  it('covers restore guard, failure branches, and catch fallbacks', async () => {
    const { result } = renderHook(() => useBackupHandlers(encryptionKeys));

    act(() => {
      result.current.setConfirmText('RESTORE');
    });
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(adminApi.restoreBackup).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleFileUpload({
        target: { files: [makeFile(validBackupJson)] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    vi.mocked(adminApi.restoreBackup).mockResolvedValueOnce({ success: false, error: 'restore blocked' } as never);
    act(() => result.current.setConfirmText('RESTORE'));
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.restoreError).toBe('restore blocked');

    vi.mocked(adminApi.restoreBackup).mockResolvedValueOnce({ success: false } as never);
    act(() => result.current.setConfirmText('RESTORE'));
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.restoreError).toBe('Restore failed');

    vi.mocked(adminApi.restoreBackup).mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.setConfirmText('RESTORE'));
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.restoreError).toBe('boom');

    vi.mocked(adminApi.restoreBackup).mockRejectedValueOnce('bad' as never);
    act(() => result.current.setConfirmText('RESTORE'));
    await act(async () => {
      await result.current.handleRestore();
    });
    expect(result.current.restoreError).toBe('Restore failed');
  });

  it('covers restore success branches with and without warnings', async () => {
    const { result } = renderHook(() => useBackupHandlers(encryptionKeys));

    await act(async () => {
      await result.current.handleFileUpload({
        target: { files: [makeFile(validBackupJson, 'ok.json')] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    vi.mocked(adminApi.restoreBackup).mockResolvedValueOnce({ success: true } as never);
    act(() => result.current.setConfirmText('RESTORE'));
    await act(async () => {
      await result.current.handleRestore();
    });

    expect(result.current.restoreSuccess).toBe(true);
    expect(notificationSpies.addNotification).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleFileUpload({
        target: { files: [makeFile(validBackupJson, 'ok-2.json')] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    vi.mocked(adminApi.restoreBackup).mockResolvedValueOnce({
      success: true,
      warnings: ['warning-1', 'warning-2'],
    } as never);

    act(() => result.current.setConfirmText('RESTORE'));
    await act(async () => {
      await result.current.handleRestore();
    });

    expect(notificationSpies.addNotification).toHaveBeenCalledTimes(2);
  });
});
