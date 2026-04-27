import { describe, expect, it } from 'vitest';
import {
  appendTurnResult,
  buildConsoleScope,
  formatShortDate,
  GENERAL_SCOPE_ID,
  getErrorMessage,
  getPromptTitle,
  getScopeLabel,
  isConsoleSetupError,
  mergePromptHistory,
  mergeSession,
  sortSessionsByUpdatedAt,
  summarizeTrace,
  turnsToMessages,
} from '../../components/ConsoleDrawer/consoleDrawerUtils';
import { ApiError } from '../../src/api/client';
import type {
  ConsolePromptHistory,
  ConsoleSession,
  ConsoleToolTrace,
  ConsoleTurn,
} from '../../src/api/console';

const baseSession: ConsoleSession = {
  id: 'session-a',
  userId: 'user-1',
  title: 'Session A',
  maxSensitivity: 'wallet',
  createdAt: '2026-04-26T01:00:00.000Z',
  updatedAt: '2026-04-26T01:00:00.000Z',
};

const basePrompt: ConsolePromptHistory = {
  id: 'prompt-a',
  userId: 'user-1',
  sessionId: baseSession.id,
  prompt: 'Prompt body',
  title: null,
  maxSensitivity: 'wallet',
  saved: false,
  expiresAt: null,
  replayCount: 0,
  lastReplayedAt: null,
  createdAt: '2026-04-26T01:00:00.000Z',
  updatedAt: '2026-04-26T01:00:00.000Z',
};

const baseTrace: ConsoleToolTrace = {
  id: 'trace-a',
  turnId: 'turn-a',
  toolName: 'wallet.summary',
  status: 'completed',
  sensitivity: 'wallet',
  createdAt: '2026-04-26T01:00:00.000Z',
  facts: { balance: 1, labels: ['cold'], nested: { count: 2 } },
  provenance: {},
  errorMessage: null,
};

const baseTurn: ConsoleTurn = {
  id: 'turn-a',
  sessionId: baseSession.id,
  promptHistoryId: basePrompt.id,
  state: 'completed',
  prompt: 'Prompt body',
  response: 'Response body',
  maxSensitivity: 'wallet',
  createdAt: '2026-04-26T01:00:00.000Z',
  completedAt: '2026-04-26T01:00:02.000Z',
  toolTraces: [baseTrace],
};

describe('console drawer utilities', () => {
  it('builds labels, scopes, prompt titles, and error messages', () => {
    expect(buildConsoleScope(GENERAL_SCOPE_ID)).toEqual({ kind: 'general' });
    expect(buildConsoleScope('wallet-1')).toEqual({
      kind: 'wallet',
      walletId: 'wallet-1',
    });
    expect(getScopeLabel({ kind: 'general' }, [])).toBe('General network');
    expect(
      getScopeLabel({ kind: 'wallet', walletId: 'wallet-1' }, [
        { id: 'wallet-1', name: 'Vault' } as any,
      ])
    ).toBe('Vault');
    expect(getScopeLabel({ kind: 'wallet', walletId: 'missing' }, [])).toBe(
      'Wallet scope'
    );
    expect(getScopeLabel({ kind: 'wallet_set', walletIds: ['a', 'b'] }, [])).toBe(
      '2 wallets'
    );
    expect(
      getScopeLabel(
        {
          kind: 'object',
          walletId: 'wallet-1',
          objectType: 'transaction',
          objectId: 'tx-1',
        },
        []
      )
    ).toBe('transaction scope');
    expect(getScopeLabel({ kind: 'admin' }, [])).toBe('Admin scope');
    expect(getPromptTitle(basePrompt)).toBe('Prompt body');
    expect(getPromptTitle({ ...basePrompt, title: 'Saved title' })).toBe(
      'Saved title'
    );
    expect(getErrorMessage(new Error('specific'), 'fallback')).toBe('specific');
    expect(getErrorMessage('nope', 'fallback')).toBe('fallback');
    expect(isConsoleSetupError(new ApiError('disabled', 403))).toBe(true);
    expect(isConsoleSetupError(new ApiError('nope', 500))).toBe(false);
  });

  it('formats dates and trace summaries across edge cases', () => {
    expect(formatShortDate(null)).toBe('');
    expect(formatShortDate('not-a-date')).toBe('');
    expect(formatShortDate('2026-04-26T01:00:00.000Z')).toContain('Apr');
    expect(summarizeTrace({ ...baseTrace, status: 'failed', errorMessage: null })).toBe(
      'Tool failed'
    );
    expect(
      summarizeTrace({
        ...baseTrace,
        status: 'failed',
        errorMessage: 'provider failed',
      })
    ).toBe('provider failed');
    expect(summarizeTrace({ ...baseTrace, status: 'denied' })).toBe(
      'Denied by scope or sensitivity'
    );
    expect(summarizeTrace({ ...baseTrace, facts: null })).toBe('Completed');
    expect(summarizeTrace({ ...baseTrace, facts: {} })).toBe('Completed');
    expect(
      summarizeTrace({
        ...baseTrace,
        facts: { missing: null, list: [1, 2], object: { a: true } },
      })
    ).toBe('missing: none · list: 2 items');
    expect(
      summarizeTrace({
        ...baseTrace,
        facts: { object: { a: true }, fn: () => undefined },
      })
    ).toBe('object: 1 fields · fn: value');
  });

  it('orders sessions and maps turn results into messages', () => {
    const later = { ...baseSession, id: 'session-b', updatedAt: '2026-04-26T02:00:00.000Z' };

    expect(sortSessionsByUpdatedAt([baseSession, later]).map((entry) => entry.id)).toEqual([
      'session-b',
      'session-a',
    ]);
    expect(mergeSession([baseSession], later).map((entry) => entry.id)).toEqual([
      'session-b',
      'session-a',
    ]);
    expect(mergeSession([baseSession, later], { ...later, title: 'Updated' })[0]?.title).toBe(
      'Updated'
    );

    const messages = turnsToMessages([
      baseTurn,
      {
        ...baseTurn,
        id: 'turn-b',
        state: 'failed',
        response: null,
        toolTraces: undefined,
      },
      { ...baseTurn, id: 'turn-c', state: 'completed', response: null, completedAt: null },
    ]);

    expect(messages.map((message) => message.content)).toContain(
      'The Console turn failed.'
    );
    expect(messages.map((message) => message.content)).toContain(
      'No response was returned.'
    );
    expect(messages[1]?.traces).toEqual([baseTrace]);
  });

  it('appends turn results and merges prompt history records', () => {
    const appended = appendTurnResult([], {
      turn: { ...baseTurn, response: null, completedAt: null },
      promptHistory: basePrompt,
      toolTraces: [baseTrace],
    });

    expect(appended).toHaveLength(2);
    expect(appended[1]?.content).toBe('No response was returned.');
    expect(appended[1]?.createdAt).toBe(baseTurn.createdAt);
    expect(appended[1]?.traces).toEqual([baseTrace]);

    expect(
      mergePromptHistory([basePrompt], { ...basePrompt, prompt: 'Updated' }).map(
        (entry) => entry.prompt
      )
    ).toEqual(['Updated']);
    expect(
      mergePromptHistory([basePrompt], { ...basePrompt, id: 'prompt-b' }).map(
        (entry) => entry.id
      )
    ).toEqual(['prompt-b', 'prompt-a']);
  });
});
