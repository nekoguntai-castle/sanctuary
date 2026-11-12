/**
 * Non-regression: a login in another tab changes the session under this tab.
 *
 * Every tab shares the HttpOnly session cookie, but each tab keeps its own
 * React `user` state. Only logout and refresh were broadcast, so after user B
 * logged in on a second tab, the first tab kept rendering user A while every
 * request it made ran as B (B's wallets under A's header, A's preference
 * patches applied to B).
 *
 * These tests drive the real UserProvider and the real refresh module over the
 * BroadcastChannel mock from tests/setup.ts.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserProvider } from '../../src/contexts/UserContext';
import * as authApi from '../../src/api/auth';
import * as twoFactorApi from '../../src/api/twoFactor';
import { ApiError } from '../../src/api/client';
import { __resetRefreshModuleForTests } from '../../src/api/refresh';
import { mockUser, TestConsumer } from './UserContext.test.fixtures';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../src/api/auth', () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  updatePreferences: vi.fn(),
  requires2FA: vi.fn((response) => response?.requires2FA === true),
  isPendingEmailVerification: vi.fn((response) => response?.emailVerificationRequired === true),
}));
vi.mock('../../src/api/twoFactor', () => ({ verify2FA: vi.fn() }));
const mockSocketDisconnect = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/websocket', () => ({
  websocketClient: { disconnect: mockSocketDisconnect },
}));
const mockClearQueryCache = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../src/providers/queryCacheReset', () => ({
  clearQueryCacheForLogout: mockClearQueryCache,
}));
const mockResetAIStatus = vi.hoisted(() => vi.fn());
const mockResetIntelligenceStatus = vi.hoisted(() => vi.fn());
vi.mock('../../src/hooks/useAIStatus', () => ({ resetAIStatusForSessionEnd: mockResetAIStatus }));
vi.mock('../../src/hooks/useIntelligenceStatus', () => ({
  resetIntelligenceStatusForSessionEnd: mockResetIntelligenceStatus,
}));
vi.mock('../../src/themes', () => ({
  themeRegistry: {
    applyTheme: vi.fn(),
    applyPattern: vi.fn(),
    applyPatternOpacity: vi.fn(),
    applyFlyoutOpacity: vi.fn(),
  },
}));

const userA = mockUser;
const userB = { ...mockUser, id: 'user-2', username: 'otheruser' };
const unauthenticated = () => new ApiError('Unauthorized', 401);

function renderTab() {
  return render(
    <UserProvider>
      <TestConsumer />
    </UserProvider>,
  );
}

/** Stands in for a second tab on the same origin. */
function openPeerTab() {
  const channel = new BroadcastChannel('sanctuary-auth');
  const received: unknown[] = [];
  channel.onmessage = (event: MessageEvent) => received.push(event.data);
  return {
    received,
    login: async (userId: string) => {
      await act(async () => {
        channel.postMessage({ type: 'login-broadcast', userId });
        await Promise.resolve();
      });
    },
    close: () => channel.close(),
  };
}

describe('UserProvider cross-tab login', () => {
  let peer: ReturnType<typeof openPeerTab>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRefreshModuleForTests();
    peer = openPeerTab();
  });

  afterEach(() => {
    peer.close();
    __resetRefreshModuleForTests();
  });

  it('switches to the user who logged in on another tab instead of acting as them unseen', async () => {
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(userA as never);
    renderTab();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('testuser'));

    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(userB as never);
    await peer.login('user-2');

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('otheruser'));
    // The previous user's cached data and live subscriptions are dropped.
    expect(mockClearQueryCache).toHaveBeenCalledTimes(1);
    expect(mockSocketDisconnect).toHaveBeenCalledTimes(1);
    // Capability status is per session too: the next user must not inherit it.
    expect(mockResetAIStatus).toHaveBeenCalledTimes(1);
    expect(mockResetIntelligenceStatus).toHaveBeenCalledTimes(1);
    expect(authApi.getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('shows the bootstrap loading state, not the previous user, while the new session loads', async () => {
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(userA as never);
    renderTab();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('testuser'));

    let resolveSecond!: (user: unknown) => void;
    vi.mocked(authApi.getCurrentUser).mockReturnValueOnce(
      new Promise((resolve) => { resolveSecond = resolve; }) as never,
    );
    await peer.login('user-2');

    expect(screen.getByTestId('user')).toHaveTextContent('null');
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await act(async () => { resolveSecond(userB); });
    expect(screen.getByTestId('user')).toHaveTextContent('otheruser');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('keeps its session when another tab logs in as the same user', async () => {
    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(userA as never);
    renderTab();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('testuser'));

    await peer.login('user-1');

    expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    expect(mockClearQueryCache).not.toHaveBeenCalled();
    expect(authApi.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('picks up the session when it was logged out and another tab logs in', async () => {
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(unauthenticated());
    renderTab();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');

    vi.mocked(authApi.getCurrentUser).mockResolvedValueOnce(userB as never);
    await peer.login('user-2');

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('otheruser'));
  });

  it('re-reads the session when another tab logged in while its own login was in flight', async () => {
    // Both logins raced on the server and this tab cannot know which one the
    // cookie ended up holding, so its own response is not proof of who it is.
    const user = userEvent.setup();
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(unauthenticated());
    renderTab();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    let resolveLogin!: (value: unknown) => void;
    vi.mocked(authApi.login).mockReturnValueOnce(
      new Promise((resolve) => { resolveLogin = resolve; }) as never,
    );
    await user.click(screen.getByTestId('login'));

    // The peer's login wins on the server: the cookie now belongs to user B.
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(userB as never);
    await peer.login('user-2');
    await act(async () => { resolveLogin({ user: userA }); });

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('otheruser'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    // Its own login still happened, so peers are told and can re-check too.
    expect(peer.received).toContainEqual({ type: 'login-broadcast', userId: 'user-1' });
  });

  it('announces its own password login, 2FA login and registration to other tabs', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.getCurrentUser).mockRejectedValueOnce(unauthenticated());
    renderTab();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    vi.mocked(authApi.login).mockResolvedValueOnce({ user: userA } as never);
    await user.click(screen.getByTestId('login'));
    await waitFor(() => expect(peer.received).toContainEqual({ type: 'login-broadcast', userId: 'user-1' }));

    vi.mocked(authApi.login).mockResolvedValueOnce({ requires2FA: true, tempToken: 't' } as never);
    await user.click(screen.getByTestId('login'));
    await waitFor(() => expect(screen.getByTestId('2fa-pending')).toHaveTextContent('yes'));
    expect(peer.received).toHaveLength(1);
    vi.mocked(twoFactorApi.verify2FA).mockResolvedValueOnce({ user: userB } as never);
    await user.click(screen.getByTestId('verify-2fa'));
    await waitFor(() => expect(peer.received).toContainEqual({ type: 'login-broadcast', userId: 'user-2' }));

    vi.mocked(authApi.register).mockResolvedValueOnce({ user: { ...userA, id: 'user-3' } } as never);
    await user.click(screen.getByTestId('register'));
    await waitFor(() => expect(peer.received).toContainEqual({ type: 'login-broadcast', userId: 'user-3' }));

    // A registration awaiting email verification establishes no session.
    vi.mocked(authApi.register).mockResolvedValueOnce(
      { emailVerificationRequired: true, message: 'Check your email' } as never,
    );
    await user.click(screen.getByTestId('register'));
    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('Check your email'));
    expect(peer.received).toHaveLength(3);
  });
});
