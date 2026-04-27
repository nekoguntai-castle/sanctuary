import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as consoleApi from '../../src/api/console';
import type { Wallet } from '../../src/api/wallets';
import {
  appendTurnResult,
  buildConsoleScope,
  GENERAL_SCOPE_ID,
  getErrorMessage,
  isConsoleSetupError,
  mergePromptHistory,
  mergeSession,
  sortSessionsByUpdatedAt,
  turnsToMessages,
} from './consoleDrawerUtils';
import type { ConsoleDrawerController, ConsoleMessage } from './types';

interface UseConsoleDrawerControllerOptions {
  isOpen: boolean;
  wallets: Wallet[];
}

const PROMPT_LIMIT = 24;

function getExpirationDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function useConsoleDrawerController({
  isOpen,
  wallets,
}: UseConsoleDrawerControllerOptions): ConsoleDrawerController {
  const [sessions, setSessions] = useState<consoleApi.ConsoleSession[]>([]);
  const [tools, setTools] = useState<consoleApi.ConsoleTool[]>([]);
  const [prompts, setPrompts] = useState<consoleApi.ConsolePromptHistory[]>([]);
  const [messages, setMessages] = useState<ConsoleMessage[]>([]);
  const [selectedSessionId, setSelectedSessionIdState] = useState<
    string | null
  >(null);
  const [selectedWalletId, setSelectedWalletId] = useState(GENERAL_SCOPE_ID);
  const [input, setInput] = useState('');
  const [promptSearch, setPromptSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [replayingPromptId, setReplayingPromptId] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const selectedSessionIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scope = useMemo(
    () => buildConsoleScope(selectedWalletId),
    [selectedWalletId]
  );

  const setSelectedSessionId = useCallback((sessionId: string | null) => {
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionIdState(sessionId);
  }, []);

  const handleConsoleError = useCallback(
    (caught: unknown, fallback: string) => {
      if (isConsoleSetupError(caught)) {
        setSetupNeeded(true);
        setError(null);
        return;
      }
      setError(getErrorMessage(caught, fallback));
    },
    []
  );

  const refreshPrompts = useCallback(async () => {
    try {
      const result = await consoleApi.listPromptHistory({
        limit: PROMPT_LIMIT,
        search: promptSearch.trim() || undefined,
      });
      setPrompts(result.prompts);
      setSetupNeeded(false);
    } catch (caught) {
      handleConsoleError(caught, 'Failed to load prompt history');
    }
  }, [handleConsoleError, promptSearch]);

  const loadSessionTurns = useCallback(
    async (sessionId: string) => {
      try {
        const result = await consoleApi.listConsoleTurns(sessionId);
        setMessages(turnsToMessages(result.turns));
        setSetupNeeded(false);
      } catch (caught) {
        handleConsoleError(caught, 'Failed to load Console session');
      }
    },
    [handleConsoleError]
  );

  const loadConsoleState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessionResult, promptResult, toolResult] = await Promise.all([
        consoleApi.listConsoleSessions(),
        consoleApi.listPromptHistory({ limit: PROMPT_LIMIT }),
        consoleApi.listConsoleTools(),
      ]);
      const orderedSessions = sortSessionsByUpdatedAt(sessionResult.sessions);
      const preferredSessionId = selectedSessionIdRef.current;
      const nextSessionId = orderedSessions.some(
        (session) => session.id === preferredSessionId
      )
        ? preferredSessionId
        : (orderedSessions[0]?.id ?? null);

      setSessions(orderedSessions);
      setPrompts(promptResult.prompts);
      setTools(toolResult.tools);
      setSelectedSessionId(nextSessionId);
      setSetupNeeded(false);

      if (nextSessionId) {
        await loadSessionTurns(nextSessionId);
      } else {
        setMessages([]);
      }
    } catch (caught) {
      handleConsoleError(caught, 'Failed to load Sanctuary Console');
    } finally {
      setLoading(false);
    }
  }, [handleConsoleError, loadSessionTurns, setSelectedSessionId]);

  useEffect(() => {
    if (!isOpen) return;
    void loadConsoleState();
  }, [isOpen, loadConsoleState]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages, sending]);

  useEffect(() => {
    if (selectedWalletId === GENERAL_SCOPE_ID) return;
    if (wallets.some((wallet) => wallet.id === selectedWalletId)) return;
    setSelectedWalletId(GENERAL_SCOPE_ID);
  }, [selectedWalletId, wallets]);

  const startNewSession = useCallback(() => {
    setSelectedSessionId(null);
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }, [setSelectedSessionId]);

  const selectSession = useCallback(
    async (sessionId: string | null) => {
      if (!sessionId) {
        startNewSession();
        return;
      }

      setSelectedSessionId(sessionId);
      await loadSessionTurns(sessionId);
    },
    [loadSessionTurns, setSelectedSessionId, startNewSession]
  );

  const sendPrompt = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;

    setInput('');
    setSending(true);
    setError(null);

    try {
      const result = await consoleApi.runConsoleTurn({
        sessionId: selectedSessionId ?? undefined,
        prompt,
        scope,
      });
      setSelectedSessionId(result.session.id);
      setSessions((current) => mergeSession(current, result.session));
      setPrompts((current) =>
        mergePromptHistory(current, result.promptHistory)
      );
      setMessages((current) => appendTurnResult(current, result));
      setSetupNeeded(false);
    } catch (caught) {
      setInput(prompt);
      handleConsoleError(caught, 'Console turn failed');
    } finally {
      setSending(false);
    }
  }, [
    handleConsoleError,
    input,
    scope,
    selectedSessionId,
    sending,
    setSelectedSessionId,
  ]);

  const replayPrompt = useCallback(
    async (promptId: string) => {
      setReplayingPromptId(promptId);
      setError(null);
      try {
        const result = await consoleApi.replayPromptHistory(promptId, {
          sessionId: selectedSessionId ?? undefined,
          scope,
        });
        setSelectedSessionId(result.session.id);
        setSessions((current) => mergeSession(current, result.session));
        setPrompts((current) =>
          mergePromptHistory(current, result.promptHistory)
        );
        setMessages((current) => appendTurnResult(current, result));
        setSetupNeeded(false);
      } catch (caught) {
        handleConsoleError(caught, 'Prompt replay failed');
      } finally {
        setReplayingPromptId(null);
      }
    },
    [handleConsoleError, scope, selectedSessionId, setSelectedSessionId]
  );

  const deletePrompt = useCallback(
    async (promptId: string) => {
      setError(null);
      try {
        await consoleApi.deletePromptHistory(promptId);
        setPrompts((current) =>
          current.filter((prompt) => prompt.id !== promptId)
        );
        setSetupNeeded(false);
      } catch (caught) {
        handleConsoleError(caught, 'Prompt delete failed');
      }
    },
    [handleConsoleError]
  );

  const togglePromptSaved = useCallback(
    async (prompt: consoleApi.ConsolePromptHistory) => {
      setError(null);
      try {
        const result = await consoleApi.updatePromptHistory(prompt.id, {
          saved: !prompt.saved,
        });
        setPrompts((current) => mergePromptHistory(current, result.prompt));
        setSetupNeeded(false);
      } catch (caught) {
        handleConsoleError(caught, 'Prompt update failed');
      }
    },
    [handleConsoleError]
  );

  const setPromptExpiration = useCallback(
    async (prompt: consoleApi.ConsolePromptHistory, days: number | null) => {
      setError(null);
      try {
        const result = await consoleApi.updatePromptHistory(prompt.id, {
          expiresAt: days === null ? null : getExpirationDate(days),
        });
        setPrompts((current) => mergePromptHistory(current, result.prompt));
        setSetupNeeded(false);
      } catch (caught) {
        handleConsoleError(caught, 'Prompt expiration update failed');
      }
    },
    [handleConsoleError]
  );

  return {
    sessions,
    tools,
    prompts,
    messages,
    selectedSessionId,
    selectedWalletId,
    input,
    promptSearch,
    loading,
    sending,
    replayingPromptId,
    error,
    setupNeeded,
    inputRef,
    messagesEndRef,
    scope,
    setInput,
    setPromptSearch,
    setSelectedWalletId,
    setSelectedSessionId,
    selectSession,
    startNewSession,
    sendPrompt,
    replayPrompt,
    deletePrompt,
    togglePromptSaved,
    setPromptExpiration,
    refreshPrompts,
  };
}
