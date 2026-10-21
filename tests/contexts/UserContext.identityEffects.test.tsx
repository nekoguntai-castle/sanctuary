/**
 * Non-regression tests for P2 `user-preference-write--user-keyed-effects-refetch`.
 *
 * Bug: every preference write gives the context `user` a new object identity
 * (once optimistically, once when the debounced PATCH settles). Effects keyed
 * on the whole `user` object re-ran, so dragging a slider refetched the device
 * list (blanking it with "Loading devices..."), re-synced draft notifications
 * for every wallet and restarted the bitcoin status poll.
 *
 * Fix: those effects key on `user?.id` (and `isAdmin` where they read it).
 * These tests drive the real `UserProvider` so the identity churn is genuine.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProvider, useUser } from '../../src/contexts/UserContext';
import * as authApi from '../../src/api/auth';
import * as devicesApi from '../../src/api/devices';
import * as draftsApi from '../../src/api/drafts';
import * as bitcoinApi from '../../src/api/bitcoin';
import type { Device } from '../../src/types';
import type { Wallet } from '../../src/api/wallets';
import { PREFERENCE_WRITE_DEBOUNCE_MS } from '../../src/contexts/useUserPreferenceMutation';
import { useDeviceListRecords } from '../../src/components/DeviceList/useDeviceListRecords';
import { useLayoutNotifications } from '../../src/components/Layout/useLayoutNotifications';
import { mockUser } from './UserContext.test.fixtures';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../src/api/auth');
vi.mock('../../src/api/devices', () => ({
  getDevices: vi.fn(),
  getDeviceModels: vi.fn(),
  deleteDevice: vi.fn(),
  updateDevice: vi.fn(),
}));
vi.mock('../../src/api/drafts', () => ({ getDrafts: vi.fn() }));
vi.mock('../../src/api/bitcoin', () => ({ getStatus: vi.fn() }));

const WALLETS = [{ id: 'w1', name: 'W1' }, { id: 'w2', name: 'W2' }] as unknown as Wallet[];
const DEVICES = [{ id: 'd1', label: 'one' }, { id: 'd2', label: 'two' }] as unknown as Device[];
const ACTIONS = { addNotification: vi.fn(() => 'notification-id'), removeNotificationsByType: vi.fn() };
const loadingLog: boolean[] = [];

function Probe() {
  const { user, login, logout, updatePreferences } = useUser();
  const records = useDeviceListRecords(user);
  useLayoutNotifications({ user, wallets: WALLETS, selectedNetwork: 'mainnet', notificationActions: ACTIONS });
  loadingLog.push(records.loading);

  const drag = () => {
    for (const patternOpacity of [55, 60, 65]) {
      void updatePreferences({ patternOpacity });
    }
  };

  return (
    <div>
      <span data-testid="auth">{String(Boolean(user))}</span>
      <span data-testid="count">{records.devices.length}</span>
      <button data-testid="login" onClick={() => { void login('testuser', 'password'); }}>login</button>
      <button data-testid="logout" onClick={logout}>logout</button>
      <button data-testid="drag" onClick={drag}>drag</button>
    </div>
  );
}

async function renderSignedIn() {
  const user = userEvent.setup();
  vi.mocked(authApi.login).mockResolvedValue({ user: mockUser } as never);
  render(<UserProvider><Probe /></UserProvider>);
  await user.click(screen.getByTestId('login'));
  await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
  await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalled());
  await waitFor(() => expect(draftsApi.getDrafts).toHaveBeenCalledTimes(WALLETS.length));
  return user;
}

async function dragAndSettle(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('drag'));
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, PREFERENCE_WRITE_DEBOUNCE_MS + 50));
  });
  expect(authApi.updatePreferences).toHaveBeenCalled();
}

const callCount = (fn: unknown) => vi.mocked(fn as () => unknown).mock.calls.length;

describe('UserProvider preference writes and identity-keyed effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadingLog.length = 0;
    vi.mocked(authApi.requires2FA).mockReturnValue(false);
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new Error('no session'));
    vi.mocked(authApi.updatePreferences).mockReset();
    vi.mocked(authApi.updatePreferences).mockImplementation(async patch => ({
      ...mockUser,
      preferences: { ...mockUser.preferences, ...patch },
    }));
    vi.mocked(devicesApi.getDevices).mockResolvedValue(DEVICES);
    vi.mocked(devicesApi.getDeviceModels).mockResolvedValue([]);
    vi.mocked(draftsApi.getDrafts).mockResolvedValue([]);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ connected: true } as never);
  });

  it('a preference drag neither refetches devices nor blanks the device list', async () => {
    const user = await renderSignedIn();
    const devicesBaseline = callCount(devicesApi.getDevices);
    const modelsBaseline = callCount(devicesApi.getDeviceModels);
    const firstLoaded = loadingLog.indexOf(false);
    expect(firstLoaded).toBeGreaterThanOrEqual(0);

    await dragAndSettle(user);

    expect(callCount(devicesApi.getDevices) - devicesBaseline).toBe(0);
    expect(callCount(devicesApi.getDeviceModels) - modelsBaseline).toBe(0);
    expect(loadingLog.slice(firstLoaded)).not.toContain(true);
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('a preference drag neither re-syncs draft notifications nor restarts the connection poll', async () => {
    const user = await renderSignedIn();
    const draftsBaseline = callCount(draftsApi.getDrafts);
    const statusBaseline = callCount(bitcoinApi.getStatus);

    await dragAndSettle(user);

    expect(callCount(draftsApi.getDrafts) - draftsBaseline).toBe(0);
    expect(callCount(bitcoinApi.getStatus) - statusBaseline).toBe(0);
  });

  it("signing in as a different user still loads that user's devices", async () => {
    const user = await renderSignedIn();
    const devicesBaseline = callCount(devicesApi.getDevices);

    await user.click(screen.getByTestId('logout'));
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('false'));
    vi.mocked(authApi.login).mockResolvedValue({ user: { ...mockUser, id: 'user-2' } } as never);
    await user.click(screen.getByTestId('login'));

    await waitFor(() => expect(callCount(devicesApi.getDevices)).toBeGreaterThan(devicesBaseline));
  });
});
