import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMcpAccess } from '../../../src/components/AISettings/hooks/useMcpAccess';

const mockGetMcpServerStatus = vi.fn();
const mockListMcpApiKeys = vi.fn();
const mockGetUsers = vi.fn();
const mockCreateMcpApiKey = vi.fn();
const mockRevokeMcpApiKey = vi.fn();
const mockLogError = vi.fn();

vi.mock('../../../src/api/admin', () => ({
  getMcpServerStatus: () => mockGetMcpServerStatus(),
  listMcpApiKeys: () => mockListMcpApiKeys(),
  getUsers: () => mockGetUsers(),
  createMcpApiKey: (input: Record<string, unknown>) => mockCreateMcpApiKey(input),
  revokeMcpApiKey: (keyId: string) => mockRevokeMcpApiKey(keyId),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => mockLogError(...args),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function makeKey(id: string, revokedAt?: string) {
  return {
    id,
    userId: 'user-1',
    name: id,
    keyPrefix: `mcp_${id}`,
    scope: {},
    createdAt: '2026-04-26T00:00:00.000Z',
    ...(revokedAt ? { revokedAt } : {}),
  };
}

function McpAccessProbe({ enabled = true }: { enabled?: boolean }) {
  const state = useMcpAccess(enabled);
  return (
    <div>
      <div data-testid="error">{state.error ?? ''}</div>
      <div data-testid="token">{state.createdToken ?? ''}</div>
      <div data-testid="key-count">{state.keys.length}</div>
      <div data-testid="key-state">{state.keys.map((key) => `${key.id}:${key.revokedAt ?? 'active'}`).join(',')}</div>
      <div data-testid="status">{String(state.status?.enabled ?? '')}</div>
      <div data-testid="users">{state.users.map((entry) => entry.id).join(',')}</div>
      <div data-testid="user-id">{state.form.userId}</div>
      <div data-testid="loading">{String(state.loading)}</div>
      <div data-testid="creating">{String(state.isCreating)}</div>
      <div data-testid="revoking">{state.revokingKeyId ?? ''}</div>
      <input
        aria-label="name"
        value={state.form.name}
        onChange={(event) => state.updateForm('name', event.target.value)}
      />
      <input
        aria-label="wallets"
        value={state.form.walletIds}
        onChange={(event) => state.updateForm('walletIds', event.target.value)}
      />
      <input
        aria-label="expires"
        value={state.form.expiresAt}
        onChange={(event) => state.updateForm('expiresAt', event.target.value)}
      />
      <button type="button" onClick={state.createKey}>create</button>
      <button type="button" onClick={() => state.revokeKey('key-1')}>revoke</button>
      <button type="button" onClick={state.dismissCreatedToken}>dismiss</button>
      <button type="button" onClick={state.refresh}>refresh</button>
    </div>
  );
}

describe('useMcpAccess hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMcpServerStatus.mockResolvedValue({ enabled: true });
    mockListMcpApiKeys.mockResolvedValue([{
      id: 'key-1',
      userId: 'user-1',
      name: 'Existing',
      keyPrefix: 'mcp_existing',
      scope: {},
      createdAt: '2026-04-26T00:00:00.000Z',
    }]);
    mockGetUsers.mockResolvedValue([{ id: 'user-1', username: 'alice', isAdmin: false }]);
    mockCreateMcpApiKey.mockResolvedValue({
      id: 'key-2',
      userId: 'user-1',
      name: 'Created',
      keyPrefix: 'mcp_created',
      scope: {},
      createdAt: '2026-04-26T00:00:00.000Z',
      apiKey: 'mcp_created_token',
    });
    mockRevokeMcpApiKey.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      name: 'Existing',
      keyPrefix: 'mcp_existing',
      scope: {},
      createdAt: '2026-04-26T00:00:00.000Z',
      revokedAt: '2026-04-27T00:00:00.000Z',
    });
  });

  it('creates keys, preserves the selected user, and dismisses one-time tokens', async () => {
    const user = userEvent.setup();
    render(<McpAccessProbe />);

    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));
    await user.type(screen.getByLabelText('name'), 'LAN key');
    await user.type(screen.getByLabelText('wallets'), 'wallet-1 wallet-2');
    await user.type(screen.getByLabelText('expires'), '2026-05-01T12:30');
    await user.click(screen.getByText('create'));

    await waitFor(() => {
      expect(mockCreateMcpApiKey).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        name: 'LAN key',
        walletIds: ['wallet-1', 'wallet-2'],
        expiresAt: expect.stringMatching(/^2026-05-01T/),
      }));
    });
    expect(screen.getByTestId('token')).toHaveTextContent('mcp_created_token');

    await user.click(screen.getByText('dismiss'));
    expect(screen.getByTestId('token')).toHaveTextContent('');
  });

  it('ignores incomplete key creation and preserves selected users on refresh', async () => {
    const user = userEvent.setup();
    render(<McpAccessProbe />);

    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('user-1'));
    await user.click(screen.getByText('create'));
    expect(mockCreateMcpApiKey).not.toHaveBeenCalled();

    mockGetUsers.mockResolvedValueOnce([{ id: 'user-2', username: 'bob', isAdmin: false }]);
    await user.click(screen.getByText('refresh'));

    await waitFor(() => {
      expect(mockGetMcpServerStatus).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId('user-id')).toHaveTextContent('user-1');
  });

  it('keeps the target user blank when no MCP users are available', async () => {
    mockGetUsers.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<McpAccessProbe />);

    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));
    await user.type(screen.getByLabelText('name'), 'No user key');
    await user.click(screen.getByText('create'));

    expect(screen.getByTestId('user-id')).toHaveTextContent('');
    expect(mockCreateMcpApiKey).not.toHaveBeenCalled();
  });

  it('surfaces create and revoke failures', async () => {
    const user = userEvent.setup();
    render(<McpAccessProbe />);

    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));
    mockCreateMcpApiKey.mockRejectedValueOnce(new Error('create failed'));
    await user.type(screen.getByLabelText('name'), 'Bad key');
    await user.click(screen.getByText('create'));

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Failed to create MCP API key');
    });

    mockRevokeMcpApiKey.mockRejectedValueOnce(new Error('revoke failed'));
    await user.click(screen.getByText('revoke'));

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Failed to revoke MCP API key');
    });
  });

  it('surfaces refresh failures', async () => {
    mockGetMcpServerStatus.mockRejectedValueOnce(new Error('load failed'));

    render(<McpAccessProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Failed to load MCP access settings');
    });
    expect(screen.getByTestId('key-count')).toHaveTextContent('0');
  });

  it('keeps a created key when an older refresh resolves last', async () => {
    const user = userEvent.setup();
    render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));

    const staleKeys = deferred<ReturnType<typeof makeKey>[]>();
    mockListMcpApiKeys.mockReturnValueOnce(staleKeys.promise);
    await user.click(screen.getByText('refresh'));
    await user.type(screen.getByLabelText('name'), 'Created');
    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('key-state')).toHaveTextContent('key-2:active'));

    await act(async () => staleKeys.resolve([makeKey('key-1')]));

    expect(screen.getByTestId('key-state')).toHaveTextContent('key-2:active');
    expect(screen.getByTestId('key-count')).toHaveTextContent('2');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('ignores an older refresh failure after a successful mutation', async () => {
    const user = userEvent.setup();
    render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));

    const staleStatus = deferred<{ enabled: boolean }>();
    mockGetMcpServerStatus.mockReturnValueOnce(staleStatus.promise);
    await user.click(screen.getByText('refresh'));
    await user.type(screen.getByLabelText('name'), 'Created');
    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('key-state')).toHaveTextContent('key-2:active'));

    await act(async () => staleStatus.reject(new Error('stale refresh failed')));

    expect(screen.getByTestId('error')).toHaveTextContent('');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('keeps a revoked key when an older refresh resolves last', async () => {
    const user = userEvent.setup();
    render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));

    const staleKeys = deferred<ReturnType<typeof makeKey>[]>();
    mockListMcpApiKeys.mockReturnValueOnce(staleKeys.promise);
    await user.click(screen.getByText('refresh'));
    await user.click(screen.getByText('revoke'));
    await waitFor(() => expect(screen.getByTestId('key-state')).toHaveTextContent('2026-04-27'));

    await act(async () => staleKeys.resolve([makeKey('key-1')]));

    expect(screen.getByTestId('key-state')).toHaveTextContent('2026-04-27');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('lets the newest overlapping refresh own all state and loading', async () => {
    const user = userEvent.setup();
    render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));

    const statusA = deferred<{ enabled: boolean }>();
    const keysA = deferred<ReturnType<typeof makeKey>[]>();
    const usersA = deferred<Array<{ id: string; username: string; isAdmin: boolean }>>();
    const statusB = deferred<{ enabled: boolean }>();
    const keysB = deferred<ReturnType<typeof makeKey>[]>();
    const usersB = deferred<Array<{ id: string; username: string; isAdmin: boolean }>>();
    mockGetMcpServerStatus.mockReturnValueOnce(statusA.promise).mockReturnValueOnce(statusB.promise);
    mockListMcpApiKeys.mockReturnValueOnce(keysA.promise).mockReturnValueOnce(keysB.promise);
    mockGetUsers.mockReturnValueOnce(usersA.promise).mockReturnValueOnce(usersB.promise);

    await user.click(screen.getByText('refresh'));
    await user.click(screen.getByText('refresh'));
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await act(async () => {
      statusB.resolve({ enabled: false });
      keysB.resolve([makeKey('key-b')]);
      usersB.resolve([{ id: 'user-b', username: 'bob', isAdmin: false }]);
    });
    expect(screen.getByTestId('status')).toHaveTextContent('false');
    expect(screen.getByTestId('key-state')).toHaveTextContent('key-b:active');
    expect(screen.getByTestId('users')).toHaveTextContent('user-b');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');

    await act(async () => {
      statusA.resolve({ enabled: true });
      keysA.resolve([makeKey('key-a')]);
      usersA.resolve([{ id: 'user-a', username: 'amy', isAdmin: false }]);
    });
    expect(screen.getByTestId('status')).toHaveTextContent('false');
    expect(screen.getByTestId('key-state')).toHaveTextContent('key-b:active');
    expect(screen.getByTestId('users')).toHaveTextContent('user-b');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('fences a pending refresh when MCP access is disabled', async () => {
    const status = deferred<{ enabled: boolean }>();
    const keys = deferred<ReturnType<typeof makeKey>[]>();
    const users = deferred<Array<{ id: string; username: string; isAdmin: boolean }>>();
    mockGetMcpServerStatus.mockReturnValueOnce(status.promise);
    mockListMcpApiKeys.mockReturnValueOnce(keys.promise);
    mockGetUsers.mockReturnValueOnce(users.promise);
    const view = render(<McpAccessProbe />);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    view.rerender(<McpAccessProbe enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    await act(async () => {
      status.resolve({ enabled: true });
      keys.resolve([makeKey('late-key')]);
      users.resolve([{ id: 'late-user', username: 'late', isAdmin: false }]);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('');
    expect(screen.getByTestId('key-count')).toHaveTextContent('0');
    expect(screen.getByTestId('users')).toHaveTextContent('');
    expect(screen.getByTestId('user-id')).toHaveTextContent('');
  });

  it('fences a pending refresh when the hook unmounts', async () => {
    const status = deferred<{ enabled: boolean }>();
    mockGetMcpServerStatus.mockReturnValueOnce(status.promise);
    const view = render(<McpAccessProbe />);

    view.unmount();
    await act(async () => status.reject(new Error('late failure')));

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('does not log a rejected create after the hook unmounts', async () => {
    const user = userEvent.setup();
    const view = render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('user-1'));

    const rejectedCreate = deferred<ReturnType<typeof makeKey> & { apiKey: string }>();
    mockCreateMcpApiKey.mockReturnValueOnce(rejectedCreate.promise);
    await user.type(screen.getByLabelText('name'), 'Unmounted create');
    await user.click(screen.getByText('create'));

    view.unmount();
    await act(async () => rejectedCreate.reject(new Error('unmounted create failed')));

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('does not log a rejected revoke after the hook unmounts', async () => {
    const user = userEvent.setup();
    const view = render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));

    const rejectedRevoke = deferred<ReturnType<typeof makeKey>>();
    mockRevokeMcpApiKey.mockReturnValueOnce(rejectedRevoke.promise);
    await user.click(screen.getByText('revoke'));

    view.unmount();
    await act(async () => rejectedRevoke.reject(new Error('unmounted revoke failed')));

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('preserves a created credential across tab disable and re-enable', async () => {
    const user = userEvent.setup();
    const view = render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));

    const oldCreate = deferred<ReturnType<typeof makeKey> & { apiKey: string }>();
    mockCreateMcpApiKey.mockReturnValueOnce(oldCreate.promise);
    await user.type(screen.getByLabelText('name'), 'Old activation');
    await user.click(screen.getByText('create'));
    expect(screen.getByTestId('creating')).toHaveTextContent('true');

    view.rerender(<McpAccessProbe enabled={false} />);
    const nextStatus = deferred<{ enabled: boolean }>();
    const nextKeys = deferred<ReturnType<typeof makeKey>[]>();
    const nextUsers = deferred<Array<{ id: string; username: string; isAdmin: boolean }>>();
    mockGetMcpServerStatus.mockReturnValueOnce(nextStatus.promise);
    mockListMcpApiKeys.mockReturnValueOnce(nextKeys.promise);
    mockGetUsers.mockReturnValueOnce(nextUsers.promise);
    view.rerender(<McpAccessProbe enabled />);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('creating')).toHaveTextContent('true');

    await act(async () => oldCreate.resolve({
      ...makeKey('old-created'),
      apiKey: 'old_activation_token',
    }));
    expect(screen.getByTestId('key-state')).toHaveTextContent('old-created:active');
    expect(screen.getByTestId('token')).toHaveTextContent('old_activation_token');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('creating')).toHaveTextContent('false');

    await act(async () => {
      nextStatus.resolve({ enabled: true });
      nextKeys.resolve([makeKey('new-activation')]);
      nextUsers.resolve([{ id: 'user-2', username: 'bob', isAdmin: false }]);
    });
    expect(screen.getByTestId('key-state')).toHaveTextContent('old-created:active');
    expect(screen.getByTestId('key-state')).not.toHaveTextContent('new-activation');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('makes public async actions no-ops while MCP access is disabled', async () => {
    const user = userEvent.setup();
    render(<McpAccessProbe enabled={false} />);

    await user.click(screen.getByText('refresh'));
    await user.click(screen.getByText('create'));
    await user.click(screen.getByText('revoke'));

    expect(mockGetMcpServerStatus).not.toHaveBeenCalled();
    expect(mockListMcpApiKeys).not.toHaveBeenCalled();
    expect(mockGetUsers).not.toHaveBeenCalled();
    expect(mockCreateMcpApiKey).not.toHaveBeenCalled();
    expect(mockRevokeMcpApiKey).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('surfaces a rejected create after tab disable and re-enable', async () => {
    const user = userEvent.setup();
    const view = render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));

    const oldCreate = deferred<ReturnType<typeof makeKey> & { apiKey: string }>();
    mockCreateMcpApiKey.mockReturnValueOnce(oldCreate.promise);
    await user.type(screen.getByLabelText('name'), 'Old activation');
    await user.click(screen.getByText('create'));
    expect(screen.getByTestId('creating')).toHaveTextContent('true');

    view.rerender(<McpAccessProbe enabled={false} />);
    view.rerender(<McpAccessProbe enabled />);
    await waitFor(() => expect(mockGetMcpServerStatus).toHaveBeenCalledTimes(2));
    await act(async () => oldCreate.reject(new Error('old create failed')));

    expect(screen.getByTestId('error')).toHaveTextContent('Failed to create MCP API key');
    expect(screen.getByTestId('creating')).toHaveTextContent('false');
    expect(mockLogError).toHaveBeenCalledOnce();
  });

  it('settles successful and rejected revokes after tab disable and re-enable', async () => {
    const user = userEvent.setup();
    const view = render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('1'));

    const successfulRevoke = deferred<ReturnType<typeof makeKey>>();
    const rejectedRevoke = deferred<ReturnType<typeof makeKey>>();
    mockRevokeMcpApiKey
      .mockReturnValueOnce(successfulRevoke.promise)
      .mockReturnValueOnce(rejectedRevoke.promise);
    await user.click(screen.getByText('revoke'));
    await user.click(screen.getByText('revoke'));
    expect(screen.getByTestId('revoking')).toHaveTextContent('key-1');

    view.rerender(<McpAccessProbe enabled={false} />);
    const nextStatus = deferred<{ enabled: boolean }>();
    const nextKeys = deferred<ReturnType<typeof makeKey>[]>();
    const nextUsers = deferred<Array<{ id: string; username: string; isAdmin: boolean }>>();
    mockGetMcpServerStatus.mockReturnValueOnce(nextStatus.promise);
    mockListMcpApiKeys.mockReturnValueOnce(nextKeys.promise);
    mockGetUsers.mockReturnValueOnce(nextUsers.promise);
    view.rerender(<McpAccessProbe enabled />);

    await act(async () => {
      successfulRevoke.resolve(makeKey('key-1', '2026-04-27T00:00:00.000Z'));
      rejectedRevoke.reject(new Error('old revoke failed'));
    });
    expect(screen.getByTestId('key-state')).toHaveTextContent('key-1:2026-04-27');
    expect(screen.getByTestId('error')).toHaveTextContent('Failed to revoke MCP API key');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('revoking')).toHaveTextContent('');
    expect(mockLogError).toHaveBeenCalledOnce();

    await act(async () => {
      nextStatus.resolve({ enabled: true });
      nextKeys.resolve([makeKey('new-activation')]);
      nextUsers.resolve([{ id: 'user-2', username: 'bob', isAdmin: false }]);
    });
    expect(screen.getByTestId('key-state')).toHaveTextContent('key-1:2026-04-27');
    expect(screen.getByTestId('key-state')).not.toHaveTextContent('new-activation');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('composes successful create and revoke mutations that finish out of order', async () => {
    const user = userEvent.setup();
    mockListMcpApiKeys.mockResolvedValueOnce([makeKey('key-1'), makeKey('key-keep')]);
    render(<McpAccessProbe />);
    await waitFor(() => expect(screen.getByTestId('key-count')).toHaveTextContent('2'));
    const created = deferred<ReturnType<typeof makeKey> & { apiKey: string }>();
    const revoked = deferred<ReturnType<typeof makeKey>>();
    mockCreateMcpApiKey.mockReturnValueOnce(created.promise);
    mockRevokeMcpApiKey.mockReturnValueOnce(revoked.promise);

    await user.type(screen.getByLabelText('name'), 'Created');
    await user.click(screen.getByText('create'));
    await user.click(screen.getByText('revoke'));
    await act(async () => revoked.resolve(makeKey('key-1', '2026-04-27T00:00:00.000Z')));
    await act(async () => created.resolve({ ...makeKey('key-2'), apiKey: 'mcp_created_token' }));

    expect(screen.getByTestId('key-state')).toHaveTextContent('key-2:active');
    expect(screen.getByTestId('key-state')).toHaveTextContent('key-1:2026-04-27');
    expect(screen.getByTestId('key-state')).toHaveTextContent('key-keep:active');
    expect(screen.getByTestId('key-count')).toHaveTextContent('3');
  });
});
