import { renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { useRestoreWarningsHandoff } from '../../../src/components/BackupRestore/hooks/useRestoreWarningsHandoff';
import {
  AppNotificationProvider,
  useAppNotifications,
} from '../../../src/contexts/AppNotificationContext';

const HANDOFF_KEY = 'sanctuary_restore_warnings_handoff';
const DAY_MS = 24 * 60 * 60 * 1000;

type MockUser = { id: string; isAdmin: boolean } | null;

const userState = vi.hoisted(() => ({
  current: { isAuthenticated: false, user: null as { id: string; isAdmin: boolean } | null },
}));

vi.mock('../../../src/contexts/UserContext', () => ({
  useUser: () => userState.current,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

function setUser(user: MockUser) {
  userState.current = { isAuthenticated: user !== null, user };
}

function seedHandoff(value: unknown) {
  sessionStorage.setItem(HANDOFF_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

function validHandoff(createdAt = Date.now()) {
  return { id: 'h-1', createdAt, warnings: ['w1', 'w2', 'w3'] };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppNotificationProvider>{children}</AppNotificationProvider>
);

function renderConsumer() {
  return renderHook(
    () => {
      useRestoreWarningsHandoff();
      return useAppNotifications().notifications;
    },
    { wrapper },
  );
}

function restoreWarnings(notifications: ReturnType<typeof useAppNotifications>['notifications']) {
  return notifications.filter((n) => n.title === 'Restore Warning');
}

describe('useRestoreWarningsHandoff', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setUser(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('adds every stashed warning for an admin and removes the key', () => {
    setUser({ id: 'admin-1', isAdmin: true });
    seedHandoff(validHandoff());

    const { result } = renderConsumer();

    const warnings = restoreWarnings(result.current);
    expect(warnings.map((n) => n.message)).toStrictEqual(['w1', 'w2', 'w3']);
    expect(warnings.map((n) => n.scopeId)).toStrictEqual(['restore:h-1:0', 'restore:h-1:1', 'restore:h-1:2']);
    expect(warnings.every((n) => n.persistent === true && n.severity === 'warning' && n.type === 'warning')).toBe(true);
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it('discards the hand-off for a non-admin', () => {
    setUser({ id: 'user-1', isAdmin: false });
    seedHandoff(validHandoff());

    const { result } = renderConsumer();

    expect(restoreWarnings(result.current)).toHaveLength(0);
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it('keeps the hand-off while unauthenticated and consumes it after an admin signs in', () => {
    seedHandoff(validHandoff());

    const { result, rerender } = renderConsumer();
    expect(restoreWarnings(result.current)).toHaveLength(0);
    expect(sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull();

    setUser({ id: 'admin-1', isAdmin: true });
    rerender();

    expect(restoreWarnings(result.current).map((n) => n.message)).toStrictEqual(['w1', 'w2', 'w3']);
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it('does not consume a stash written during the same session, only after a different login', () => {
    setUser({ id: 'admin-1', isAdmin: true });
    const { result, rerender } = renderConsumer();

    seedHandoff(validHandoff());
    rerender();
    expect(restoreWarnings(result.current)).toHaveLength(0);
    expect(sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull();

    setUser({ id: 'admin-2', isAdmin: true });
    rerender();
    expect(restoreWarnings(result.current).map((n) => n.message)).toStrictEqual(['w1', 'w2', 'w3']);
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it.each([
    ['an expired hand-off', validHandoff(Date.now() - DAY_MS - 60_000)],
    ['malformed JSON', '{not json'],
    ['non-array warnings', { id: 'h-1', createdAt: Date.now(), warnings: 'w1' }],
    ['empty warnings', { id: 'h-1', createdAt: Date.now(), warnings: [] }],
    ['non-string warnings', { id: 'h-1', createdAt: Date.now(), warnings: [1, 2] }],
    ['a missing id', { createdAt: Date.now(), warnings: ['w1'] }],
  ])('removes %s and adds nothing', (_label, value) => {
    setUser({ id: 'admin-1', isAdmin: true });
    seedHandoff(value);

    const { result } = renderConsumer();

    expect(restoreWarnings(result.current)).toHaveLength(0);
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it('adds nothing and does not throw when sessionStorage cannot be read', () => {
    setUser({ id: 'admin-1', isAdmin: true });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const { result } = renderConsumer();

    expect(restoreWarnings(result.current)).toHaveLength(0);
  });
});
