import type { ChangeEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackupHandlers } from '../../../src/components/BackupRestore/hooks/useBackupHandlers';
import * as adminApi from '../../../src/api/admin';
import type { ValidationResult } from '../../../src/api/admin';

const log = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => log }));
vi.mock('../../../src/api/admin', () => ({ validateBackup: vi.fn() }));
vi.mock('../../../src/contexts/AppNotificationContext', () => ({
  useAppNotifications: () => ({ addNotification: vi.fn() }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const backup = (name: string) => JSON.stringify({ version: '1.0.0', data: { name } });
const event = (name: string, text: () => Promise<string>) => ({
  target: { files: [{ name, text }] },
}) as unknown as ChangeEvent<HTMLInputElement>;
const valid = { valid: true, warnings: [] } as unknown as ValidationResult;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.validateBackup).mockResolvedValue(valid);
});

describe('backup upload request ownership', () => {
  it.each(['success', 'error'] as const)('ignores stale file read %s without validation, logging or resetting the new input', async outcome => {
    const old = deferred<string>();
    const next = deferred<string>();
    const { result } = renderHook(() => useBackupHandlers(null));
    const input = { value: 'B.json' } as HTMLInputElement;
    result.current.fileInputRef.current = input;
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.handleFileUpload(event('A.json', () => old.promise)); });
    act(() => { second = result.current.handleFileUpload(event('B.json', () => next.promise)); });
    await act(async () => {
      if (outcome === 'success') old.resolve(backup('A'));
      else old.reject(new Error('secret old payload'));
      await first;
    });
    expect(adminApi.validateBackup).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(input.value).toBe('B.json');
    expect(result.current.uploadedBackup).toBeNull();
    expect(result.current.isValidating).toBe(true);
    await act(async () => { next.resolve(backup('B')); await second; });
    expect(result.current.uploadedFileName).toBe('B.json');
    expect(result.current.validationResult).toEqual(valid);
    expect(input.value).toBe('');
  });

  it.each(['success', 'error'] as const)('ignores obsolete validation %s while the new file remains pending', async outcome => {
    const old = deferred<ValidationResult>();
    const next = deferred<ValidationResult>();
    vi.mocked(adminApi.validateBackup).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useBackupHandlers(null));
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => { first = result.current.handleFileUpload(event('A.json', async () => backup('A'))); });
    act(() => { result.current.setConfirmText('RESTORE'); result.current.setShowConfirmModal(true); });
    await act(async () => { second = result.current.handleFileUpload(event('B.json', async () => backup('B'))); });
    const input = { value: 'B.json' } as HTMLInputElement;
    result.current.fileInputRef.current = input;
    expect(result.current.confirmText).toBe('');
    expect(result.current.showConfirmModal).toBe(false);
    await act(async () => {
      if (outcome === 'success') old.resolve(valid);
      else old.reject(new Error('old validation error'));
      await first;
    });
    expect(result.current.uploadedFileName).toBe('B.json');
    expect(result.current.validationResult).toBeNull();
    expect(result.current.restoreError).toBeNull();
    expect(result.current.isValidating).toBe(true);
    expect(input.value).toBe('B.json');
    expect(log.error).not.toHaveBeenCalled();
    await act(async () => { next.resolve({ ...valid, valid: false }); await second; });
    expect(result.current.validationResult?.valid).toBe(false);
    expect(result.current.isValidating).toBe(false);
  });

  it.each(['clear', 'unmount'] as const)('invalidates pending read on %s', async action => {
    const read = deferred<string>();
    const { result, unmount } = renderHook(() => useBackupHandlers(null));
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleFileUpload(event('A.json', () => read.promise)); });
    if (action === 'clear') act(() => result.current.handleClearUpload());
    else unmount();
    await act(async () => { read.resolve(backup('A')); await pending; });
    expect(adminApi.validateBackup).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    if (action === 'clear') {
      expect(result.current.isValidating).toBe(false);
      expect(result.current.uploadedFileName).toBeNull();
    }
  });

  it.each(['clear', 'unmount'] as const)('invalidates pending validation on %s', async action => {
    const validation = deferred<ValidationResult>();
    vi.mocked(adminApi.validateBackup).mockReturnValueOnce(validation.promise);
    const { result, unmount } = renderHook(() => useBackupHandlers(null));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.handleFileUpload(event('A.json', async () => backup('A'))); });
    const input = { value: 'untouched' } as HTMLInputElement;
    result.current.fileInputRef.current = input;
    if (action === 'clear') act(() => result.current.handleClearUpload());
    else unmount();
    await act(async () => { validation.reject(new Error('stale validation')); await pending; });
    expect(log.error).not.toHaveBeenCalled();
    expect(input.value).toBe('untouched');
    if (action === 'clear') {
      expect(result.current.isValidating).toBe(false);
      expect(result.current.restoreError).toBeNull();
      expect(result.current.validationResult).toBeNull();
    }
  });

  it('keeps the current validation owner when the picker returns no file', async () => {
    const validation = deferred<ValidationResult>();
    vi.mocked(adminApi.validateBackup).mockReturnValueOnce(validation.promise);
    const { result } = renderHook(() => useBackupHandlers(null));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.handleFileUpload(event('A.json', async () => backup('A'))); });
    await act(async () => {
      await result.current.handleFileUpload({ target: { files: [] } } as unknown as ChangeEvent<HTMLInputElement>);
    });
    expect(result.current.uploadedFileName).toBe('A.json');
    expect(result.current.isValidating).toBe(true);
    await act(async () => { validation.resolve(valid); await pending; });
    expect(result.current.validationResult).toEqual(valid);
  });

  it('clears the previous file and confirmation before a replacement read fails', async () => {
    const { result } = renderHook(() => useBackupHandlers(null));
    await act(async () => { await result.current.handleFileUpload(event('A.json', async () => backup('A'))); });
    act(() => { result.current.setConfirmText('RESTORE'); result.current.setShowConfirmModal(true); });
    const read = deferred<string>();
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleFileUpload(event('B.json', () => read.promise)); });
    expect(result.current.uploadedFileName).toBeNull();
    expect(result.current.validationResult).toBeNull();
    expect(result.current.confirmText).toBe('');
    expect(result.current.showConfirmModal).toBe(false);
    await act(async () => { read.reject(new Error('PRIVATE_FILE_CONTENT')); await pending; });
    expect(result.current.isValidating).toBe(false);
    expect(result.current.restoreError).toContain('Invalid backup file format');
    expect(log.error).toHaveBeenCalledWith('Failed to parse backup file');
  });

  it('does not log sensitive malformed JSON or the parser error', async () => {
    const { result } = renderHook(() => useBackupHandlers(null));
    await act(async () => { await result.current.handleFileUpload(event('A.json', async () => '{"secret":"PRIVATE_PAYLOAD"')); });
    expect(result.current.restoreError).toContain('Invalid backup file format');
    expect(log.error).toHaveBeenCalledWith('Failed to parse backup file');
    expect(adminApi.validateBackup).not.toHaveBeenCalled();
  });
});
