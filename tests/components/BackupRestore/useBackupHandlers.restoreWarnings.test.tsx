import { act,renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import * as adminApi from '../../../src/api/admin';
import { triggerLogout } from '../../../src/api/refresh';
import { useBackupHandlers } from '../../../src/components/BackupRestore/hooks/useBackupHandlers';
import {
  AppNotificationProvider,
  useAppNotifications,
} from '../../../src/contexts/AppNotificationContext';

const HANDOFF_KEY = 'sanctuary_restore_warnings_handoff';

vi.mock('../../../src/api/admin', () => ({
  createBackup: vi.fn(),
  validateBackup: vi.fn(),
  restoreBackup: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const validBackupJson = JSON.stringify({ version: '1.0.0', data: { wallets: [] } });

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppNotificationProvider>{children}</AppNotificationProvider>
);

function renderRestoreHarness() {
  return renderHook(
    () => ({ handlers: useBackupHandlers(null), notifications: useAppNotifications().notifications }),
    { wrapper },
  );
}

type Harness = ReturnType<typeof renderRestoreHarness>;

async function restoreWithWarnings(harness: Harness) {
  const file = { name: 'backup.json', text: vi.fn().mockResolvedValue(validBackupJson) } as unknown as File;
  await act(async () => {
    await harness.result.current.handlers.handleFileUpload({
      target: { files: [file] },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  });
  act(() => harness.result.current.handlers.setConfirmText('RESTORE'));
  await act(async () => {
    await harness.result.current.handlers.handleRestore();
  });
}

describe('useBackupHandlers restore warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(adminApi.validateBackup).mockResolvedValue({ valid: true, warnings: [] } as never);
    vi.mocked(adminApi.restoreBackup).mockResolvedValue({ success: true, warnings: ['w1', 'w2', 'w3'] } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('shows every restore warning as its own notification', async () => {
    const harness = renderRestoreHarness();

    await restoreWithWarnings(harness);

    const warnings = harness.result.current.notifications.filter((n) => n.title === 'Restore Warning');
    expect(warnings.map((n) => n.message)).toStrictEqual(['w1', 'w2', 'w3']);
    expect(new Set(warnings.map((n) => n.scopeId)).size).toBe(3);
    expect(warnings.every((n) => n.severity === 'warning')).toBe(true);

    // Unmount before the 3 s reload: jsdom has no location.reload.
    harness.unmount();
  });

  it('keeps the warnings in a sessionStorage hand-off that survives the terminal-logout wipe', async () => {
    const harness = renderRestoreHarness();

    await restoreWithWarnings(harness);

    const stored = sessionStorage.getItem(HANDOFF_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string).warnings).toStrictEqual(['w1', 'w2', 'w3']);

    act(() => triggerLogout());

    expect(harness.result.current.notifications).toStrictEqual([]);
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBe(stored);

    harness.unmount();
  });
});
