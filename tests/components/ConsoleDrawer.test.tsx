import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleDrawer } from '../../components/ConsoleDrawer';
import { ApiError } from '../../src/api/client';
import * as consoleApi from '../../src/api/console';

vi.mock('../../src/api/console', () => ({
  listConsoleTools: vi.fn(),
  listConsoleSessions: vi.fn(),
  createConsoleSession: vi.fn(),
  listConsoleTurns: vi.fn(),
  runConsoleTurn: vi.fn(),
  listPromptHistory: vi.fn(),
  updatePromptHistory: vi.fn(),
  deletePromptHistory: vi.fn(),
  replayPromptHistory: vi.fn(),
}));

const session = {
  id: 'session-12345678',
  userId: 'user-1',
  title: 'Recent session',
  maxSensitivity: 'wallet',
  createdAt: '2026-04-26T01:00:00.000Z',
  updatedAt: '2026-04-26T01:05:00.000Z',
};

const promptHistory = {
  id: 'prompt-1',
  userId: 'user-1',
  sessionId: session.id,
  prompt: 'How long ago was block 800000?',
  title: 'Block age',
  maxSensitivity: 'wallet',
  saved: false,
  expiresAt: null,
  replayCount: 0,
  lastReplayedAt: null,
  createdAt: '2026-04-26T01:00:00.000Z',
  updatedAt: '2026-04-26T01:00:00.000Z',
};

const completedTurn = {
  id: 'turn-1',
  sessionId: session.id,
  promptHistoryId: promptHistory.id,
  state: 'completed',
  prompt: 'How long ago was block 800000?',
  response: 'Block 800000 was mined about 2 years ago.',
  maxSensitivity: 'wallet',
  createdAt: '2026-04-26T01:00:00.000Z',
  completedAt: '2026-04-26T01:00:02.000Z',
};

const wallets = [
  { id: 'wallet-1', name: 'Main Vault', type: 'single_sig' },
] as any;

function mockConsoleReadyState() {
  vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
    sessions: [],
  } as any);
  vi.mocked(consoleApi.listPromptHistory).mockResolvedValue({
    prompts: [promptHistory],
  } as any);
  vi.mocked(consoleApi.listConsoleTools).mockResolvedValue({
    tools: [
      {
        name: 'read.block',
        title: 'Read block',
        description: 'Read block data',
        sensitivity: 'public',
        requiredScope: 'general',
        inputFields: ['height'],
        available: true,
        budgets: {},
      },
    ],
  } as any);
  vi.mocked(consoleApi.listConsoleTurns).mockResolvedValue({
    turns: [],
  } as any);
  vi.mocked(consoleApi.runConsoleTurn).mockResolvedValue({
    session,
    turn: completedTurn,
    promptHistory,
    toolTraces: [],
  } as any);
  vi.mocked(consoleApi.replayPromptHistory).mockResolvedValue({
    session,
    turn: completedTurn,
    promptHistory: { ...promptHistory, replayCount: 1 },
    toolTraces: [],
  } as any);
  vi.mocked(consoleApi.updatePromptHistory).mockResolvedValue({
    prompt: { ...promptHistory, saved: true },
  } as any);
  vi.mocked(consoleApi.deletePromptHistory).mockResolvedValue({
    success: true,
  });
}

function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof ConsoleDrawer>> = {}
) {
  return render(
    <MemoryRouter>
      <ConsoleDrawer
        isOpen
        onClose={vi.fn()}
        wallets={wallets}
        isAdmin
        {...overrides}
      />
    </MemoryRouter>
  );
}

describe('ConsoleDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleReadyState();
  });

  it('loads Console state and submits a general-scope prompt', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await screen.findByText('Block age');

    await user.type(
      screen.getByLabelText('Console prompt'),
      'How long ago was block 800000?'
    );
    await user.click(screen.getByRole('button', { name: 'Send prompt' }));

    await waitFor(() => {
      expect(consoleApi.runConsoleTurn).toHaveBeenCalledWith({
        prompt: 'How long ago was block 800000?',
        scope: { kind: 'general' },
      });
    });
    expect(
      await screen.findByText('Block 800000 was mined about 2 years ago.')
    ).toBeInTheDocument();
  });

  it('replays, saves, expires, and deletes prompt history rows', async () => {
    renderDrawer();
    await screen.findByText('Block age');

    fireEvent.click(screen.getByRole('button', { name: 'Replay prompt' }));
    await waitFor(() => {
      expect(consoleApi.replayPromptHistory).toHaveBeenCalledWith('prompt-1', {
        scope: { kind: 'general' },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));
    await waitFor(() => {
      expect(consoleApi.updatePromptHistory).toHaveBeenCalledWith('prompt-1', {
        saved: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expire in 30 days' }));
    await waitFor(() => {
      expect(consoleApi.updatePromptHistory).toHaveBeenCalledWith('prompt-1', {
        expiresAt: expect.any(String),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete prompt' }));
    await waitFor(() => {
      expect(consoleApi.deletePromptHistory).toHaveBeenCalledWith('prompt-1');
    });
  });

  it('shows the setup state when the Console backend is unavailable', async () => {
    vi.mocked(consoleApi.listConsoleSessions).mockRejectedValue(
      new ApiError('Console is disabled', 403)
    );

    renderDrawer();

    expect(
      await screen.findByText('Console setup required')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI Settings' })).toHaveAttribute(
      'href',
      '/admin/ai'
    );
  });
});
