import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMcpAccess } from '../../../components/AISettings/hooks/useMcpAccess';

const mockGetMcpServerStatus = vi.fn();
const mockListMcpApiKeys = vi.fn();
const mockGetUsers = vi.fn();
const mockCreateMcpApiKey = vi.fn();
const mockRevokeMcpApiKey = vi.fn();

vi.mock('../../../src/api/admin', () => ({
  getMcpServerStatus: () => mockGetMcpServerStatus(),
  listMcpApiKeys: () => mockListMcpApiKeys(),
  getUsers: () => mockGetUsers(),
  createMcpApiKey: (input: Record<string, unknown>) => mockCreateMcpApiKey(input),
  revokeMcpApiKey: (keyId: string) => mockRevokeMcpApiKey(keyId),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
  }),
}));

function McpAccessProbe() {
  const state = useMcpAccess(true);
  return (
    <div>
      <div data-testid="error">{state.error ?? ''}</div>
      <div data-testid="token">{state.createdToken ?? ''}</div>
      <div data-testid="key-count">{state.keys.length}</div>
      <div data-testid="user-id">{state.form.userId}</div>
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
});
