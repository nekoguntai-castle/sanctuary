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

const expiringPromptHistory = {
  ...promptHistory,
  id: 'prompt-expiring',
  title: '',
  saved: true,
  expiresAt: '2026-05-26T01:00:00.000Z',
  updatedAt: 'not-a-date',
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

const trace = {
  id: 'trace-1',
  turnId: completedTurn.id,
  toolName: 'read.block',
  status: 'completed',
  sensitivity: 'public',
  startedAt: '2026-04-26T01:00:00.000Z',
  completedAt: '2026-04-26T01:00:01.000Z',
  facts: { height: 800000 },
  provenance: [],
  redactions: [],
  truncation: null,
  errorMessage: null,
};

const olderSession = {
  ...session,
  id: 'session-older',
  title: '',
  updatedAt: '2026-04-26T00:30:00.000Z',
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

  it('does not render when closed', () => {
    renderDrawer({ isOpen: false });

    expect(
      screen.queryByRole('dialog', { name: 'Sanctuary Console' })
    ).not.toBeInTheDocument();
  });

  it('restores no focus when no active element is available', async () => {
    const activeElementDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'activeElement'
    );
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      value: null,
    });

    try {
      renderDrawer();
      await screen.findByText('Block age');

      fireEvent.click(screen.getByRole('button', { name: 'Close Console' }));
    } finally {
      if (activeElementDescriptor) {
        Object.defineProperty(document, 'activeElement', activeElementDescriptor);
      } else {
        delete (document as unknown as { activeElement?: Element | null })
          .activeElement;
      }
    }
  });

  it('handles session selection, wallet scope, keyboard send, prompt search, and close controls', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: undefined,
    });
    vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
      sessions: [olderSession, session],
    } as any);
    vi.mocked(consoleApi.listConsoleTurns).mockResolvedValue({
      turns: [{ ...completedTurn, toolTraces: [trace] }],
    } as any);

    try {
      const view = renderDrawer({ onClose });

      await screen.findByText('Recent session');
      expect(screen.getByTitle('height: 800000')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Console session'), {
        target: { value: olderSession.id },
      });
      await waitFor(() => {
        expect(consoleApi.listConsoleTurns).toHaveBeenCalledWith(olderSession.id);
      });

      view.rerender(
        <MemoryRouter>
          <ConsoleDrawer
            isOpen={false}
            onClose={onClose}
            wallets={wallets}
            isAdmin
          />
        </MemoryRouter>
      );
      view.rerender(
        <MemoryRouter>
          <ConsoleDrawer isOpen onClose={onClose} wallets={wallets} isAdmin />
        </MemoryRouter>
      );
      await waitFor(() => {
        expect(screen.getByLabelText('Console session')).toHaveValue(
          olderSession.id
        );
      });

      fireEvent.change(screen.getByLabelText('Console session'), {
        target: { value: 'new-session' },
      });
      expect(screen.getByText('Ready')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Console scope'), {
        target: { value: 'wallet-1' },
      });
      await user.type(
        screen.getByLabelText('Console prompt'),
        'summarize this wallet'
      );
      fireEvent.keyDown(screen.getByLabelText('Console prompt'), {
        key: 'Enter',
      });

      await waitFor(() => {
        expect(consoleApi.runConsoleTurn).toHaveBeenCalledWith({
          prompt: 'summarize this wallet',
          scope: { kind: 'wallet', walletId: 'wallet-1' },
        });
      });

      await user.type(screen.getByLabelText('Search prompt history'), 'block');
      expect(screen.getByLabelText('Search prompt history')).toHaveValue('block');
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh prompt history' })
      );
      await waitFor(() => {
        expect(consoleApi.listPromptHistory).toHaveBeenCalledWith({
          limit: 24,
          search: 'block',
        });
      });

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole('button', { name: 'Close Console backdrop' })
      );
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
    }
  });

  it('falls back to general scope when a selected wallet disappears', async () => {
    const view = renderDrawer();
    await screen.findByText('Block age');

    fireEvent.change(screen.getByLabelText('Console scope'), {
      target: { value: 'wallet-1' },
    });
    expect(screen.getByLabelText('Console scope')).toHaveValue('wallet-1');

    view.rerender(
      <MemoryRouter>
        <ConsoleDrawer isOpen onClose={vi.fn()} wallets={[]} isAdmin />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Console scope')).toHaveValue('general');
    });
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

  it('clears expiration and unsaves prompts with existing expiration metadata', async () => {
    vi.mocked(consoleApi.listPromptHistory).mockResolvedValue({
      prompts: [expiringPromptHistory],
    } as any);
    vi.mocked(consoleApi.updatePromptHistory).mockResolvedValue({
      prompt: expiringPromptHistory,
    } as any);

    renderDrawer();
    await screen.findByText('How long ago was block 800000?');

    fireEvent.click(screen.getByRole('button', { name: 'Unsave prompt' }));
    await waitFor(() => {
      expect(consoleApi.updatePromptHistory).toHaveBeenCalledWith(
        'prompt-expiring',
        { saved: false }
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear expiration' }));
    await waitFor(() => {
      expect(consoleApi.updatePromptHistory).toHaveBeenCalledWith(
        'prompt-expiring',
        { expiresAt: null }
      );
    });
  });

  it('surfaces operation errors without dropping prompt history rows', async () => {
    vi.mocked(consoleApi.replayPromptHistory).mockRejectedValueOnce(
      new Error('replay broke')
    );
    vi.mocked(consoleApi.updatePromptHistory)
      .mockRejectedValueOnce(new Error('save broke'))
      .mockRejectedValueOnce(new Error('expire broke'));
    vi.mocked(consoleApi.deletePromptHistory).mockRejectedValueOnce(
      new Error('delete broke')
    );

    renderDrawer();
    await screen.findByText('Block age');

    fireEvent.click(screen.getByRole('button', { name: 'Replay prompt' }));
    expect(await screen.findByText('replay broke')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));
    expect(await screen.findByText('save broke')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expire in 30 days' }));
    expect(await screen.findByText('expire broke')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete prompt' }));
    expect(await screen.findByText('delete broke')).toBeInTheDocument();
    expect(screen.getByText('Block age')).toBeInTheDocument();
  });

  it('surfaces prompt refresh and session-turn load errors', async () => {
    vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
      sessions: [session],
    } as any);
    vi.mocked(consoleApi.listConsoleTurns).mockRejectedValueOnce(
      new Error('turns unavailable')
    );

    renderDrawer();

    expect(await screen.findByText('turns unavailable')).toBeInTheDocument();

    vi.mocked(consoleApi.listPromptHistory).mockRejectedValueOnce('network down');
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh prompt history' })
    );

    expect(
      await screen.findByText('Failed to load prompt history')
    ).toBeInTheDocument();
  });

  it('restores the prompt text when sending fails', async () => {
    const user = userEvent.setup();
    vi.mocked(consoleApi.runConsoleTurn).mockRejectedValueOnce(
      new Error('provider down')
    );

    renderDrawer();
    await screen.findByText('Block age');

    await user.type(screen.getByLabelText('Console prompt'), 'will fail');
    await user.click(screen.getByRole('button', { name: 'Send prompt' }));

    expect(await screen.findByText('provider down')).toBeInTheDocument();
    expect(screen.getByLabelText('Console prompt')).toHaveValue('will fail');
  });

  it('ignores empty prompt submissions', async () => {
    renderDrawer();
    await screen.findByText('Block age');

    fireEvent.keyDown(screen.getByLabelText('Console prompt'), {
      key: 'Enter',
    });

    expect(consoleApi.runConsoleTurn).not.toHaveBeenCalled();
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

  it('hides the setup link for non-admin users', async () => {
    vi.mocked(consoleApi.listConsoleSessions).mockRejectedValue(
      new ApiError('Console is disabled', 403)
    );

    renderDrawer({ isAdmin: false });

    expect(
      await screen.findByText('Console setup required')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'AI Settings' })
    ).not.toBeInTheDocument();
  });
});
