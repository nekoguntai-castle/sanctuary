import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as consoleApi from "../../src/api/console";
import type { Wallet } from "../../src/api/wallets";
import {
  ALL_WALLETS_SCOPE_ID,
  AUTO_CONTEXT_ID,
  appendFailedAssistantMessage,
  appendPendingPrompt,
  appendTurnResult,
  buildConsoleClientContext,
  buildConsoleScope,
  buildWalletSetScopeIds,
  GENERAL_SCOPE_ID,
  getConsoleSetupErrorReason,
  getErrorDetails,
  getErrorMessage,
  mergePromptHistory,
  mergeSession,
  replacePendingPromptWithTurnResult,
  sortSessionsByUpdatedAt,
  turnsToMessages,
} from "./consoleDrawerUtils";
import type { ConsoleDrawerController, ConsoleMessage } from "./types";

interface UseConsoleDrawerControllerOptions {
  isOpen: boolean;
  wallets: Wallet[];
  defaultWalletId?: string | null;
  onTurnComplete?: (result: consoleApi.ConsoleTurnResult) => void;
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
  defaultWalletId,
  onTurnComplete,
}: UseConsoleDrawerControllerOptions): ConsoleDrawerController {
  const [sessions, setSessions] = useState<consoleApi.ConsoleSession[]>([]);
  const [tools, setTools] = useState<consoleApi.ConsoleTool[]>([]);
  const [prompts, setPrompts] = useState<consoleApi.ConsolePromptHistory[]>([]);
  const [messages, setMessages] = useState<ConsoleMessage[]>([]);
  const [selectedSessionId, setSelectedSessionIdState] = useState<
    string | null
  >(null);
  const [selectedWalletId, setSelectedWalletId] = useState(AUTO_CONTEXT_ID);
  const [input, setInput] = useState("");
  const [promptSearch, setPromptSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [replayingPromptId, setReplayingPromptId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [setupReason, setSetupReason] =
    useState<consoleApi.ConsoleSetupReason | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  const pendingMessageCounterRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scope = useMemo(
    () => buildConsoleScope(selectedWalletId, wallets),
    [selectedWalletId, wallets],
  );
  const clientContext = useMemo(
    () => buildConsoleClientContext(selectedWalletId, defaultWalletId),
    [defaultWalletId, selectedWalletId],
  );

  const setSelectedSessionId = useCallback((sessionId: string | null) => {
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionIdState(sessionId);
  }, []);

  const handleConsoleError = useCallback(
    (caught: unknown, fallback: string) => {
      const reason = getConsoleSetupErrorReason(caught);
      if (reason) {
        setSetupReason(reason);
        setError(null);
        return;
      }
      setError(getErrorMessage(caught, fallback));
    },
    [],
  );

  const refreshPrompts = useCallback(async () => {
    try {
      const result = await consoleApi.listPromptHistory({
        limit: PROMPT_LIMIT,
        search: promptSearch.trim() || undefined,
      });
      setPrompts(result.prompts);
      setSetupReason(null);
    } catch (caught) {
      handleConsoleError(caught, "Failed to load prompt history");
    }
  }, [handleConsoleError, promptSearch]);

  const loadSessionTurns = useCallback(
    async (sessionId: string) => {
      try {
        const result = await consoleApi.listConsoleTurns(sessionId);
        setMessages(turnsToMessages(result.turns));
        setSetupReason(null);
      } catch (caught) {
        handleConsoleError(caught, "Failed to load Console session");
      }
    },
    [handleConsoleError],
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
        (session) => session.id === preferredSessionId,
      )
        ? preferredSessionId
        : (orderedSessions[0]?.id ?? null);

      setSessions(orderedSessions);
      setPrompts(promptResult.prompts);
      setTools(toolResult.tools);
      setSelectedSessionId(nextSessionId);
      setSetupReason(null);

      if (nextSessionId) {
        await loadSessionTurns(nextSessionId);
      } else {
        setMessages([]);
      }
    } catch (caught) {
      handleConsoleError(caught, "Failed to load Sanctuary Console");
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
      behavior: "smooth",
      block: "end",
    });
  }, [messages, sending]);

  useEffect(() => {
    if (
      selectedWalletId === AUTO_CONTEXT_ID ||
      selectedWalletId === GENERAL_SCOPE_ID
    ) {
      return;
    }
    if (
      selectedWalletId === ALL_WALLETS_SCOPE_ID &&
      buildWalletSetScopeIds(wallets).length > 0
    ) {
      return;
    }
    if (wallets.some((wallet) => wallet.id === selectedWalletId)) return;
    setSelectedWalletId(AUTO_CONTEXT_ID);
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
    [loadSessionTurns, setSelectedSessionId, startNewSession],
  );

  const sendPrompt = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;

    pendingMessageCounterRef.current += 1;
    const pendingPromptId = `pending:${pendingMessageCounterRef.current}`;

    setInput("");
    setSending(true);
    setError(null);
    setMessages((current) =>
      appendPendingPrompt(current, {
        id: pendingPromptId,
        prompt,
        createdAt: new Date().toISOString(),
      }),
    );

    try {
      const result = await consoleApi.runConsoleTurn({
        sessionId: selectedSessionId ?? undefined,
        prompt,
        ...(clientContext ? { clientContext } : { scope }),
      });
      setSelectedSessionId(result.session.id);
      setSessions((current) => mergeSession(current, result.session));
      setPrompts((current) =>
        mergePromptHistory(current, result.promptHistory),
      );
      setMessages((current) =>
        replacePendingPromptWithTurnResult(current, pendingPromptId, result),
      );
      setSetupReason(null);
      onTurnComplete?.(result);
    } catch (caught) {
      const setupErrorReason = getConsoleSetupErrorReason(caught);
      if (setupErrorReason) {
        setInput(prompt);
        handleConsoleError(caught, "Console turn failed");
      } else {
        setMessages((current) =>
          appendFailedAssistantMessage(current, {
            id: `${pendingPromptId}:failed`,
            content: getErrorMessage(caught, "Console turn failed"),
            createdAt: new Date().toISOString(),
            details: getErrorDetails(caught),
          }),
        );
      }
    } finally {
      setSending(false);
    }
  }, [
    handleConsoleError,
    input,
    clientContext,
    onTurnComplete,
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
          ...(clientContext ? { clientContext } : { scope }),
        });
        setSelectedSessionId(result.session.id);
        setSessions((current) => mergeSession(current, result.session));
        setPrompts((current) =>
          mergePromptHistory(current, result.promptHistory),
        );
        setMessages((current) => appendTurnResult(current, result));
        setSetupReason(null);
        onTurnComplete?.(result);
      } catch (caught) {
        handleConsoleError(caught, "Prompt replay failed");
      } finally {
        setReplayingPromptId(null);
      }
    },
    [
      handleConsoleError,
      clientContext,
      onTurnComplete,
      scope,
      selectedSessionId,
      setSelectedSessionId,
    ],
  );

  const deletePrompt = useCallback(
    async (promptId: string) => {
      setError(null);
      try {
        await consoleApi.deletePromptHistory(promptId);
        setPrompts((current) =>
          current.filter((prompt) => prompt.id !== promptId),
        );
        setSetupReason(null);
      } catch (caught) {
        handleConsoleError(caught, "Prompt delete failed");
      }
    },
    [handleConsoleError],
  );

  const togglePromptSaved = useCallback(
    async (prompt: consoleApi.ConsolePromptHistory) => {
      setError(null);
      try {
        const result = await consoleApi.updatePromptHistory(prompt.id, {
          saved: !prompt.saved,
        });
        setPrompts((current) => mergePromptHistory(current, result.prompt));
        setSetupReason(null);
      } catch (caught) {
        handleConsoleError(caught, "Prompt update failed");
      }
    },
    [handleConsoleError],
  );

  const setPromptExpiration = useCallback(
    async (prompt: consoleApi.ConsolePromptHistory, days: number | null) => {
      setError(null);
      try {
        const result = await consoleApi.updatePromptHistory(prompt.id, {
          expiresAt: days === null ? null : getExpirationDate(days),
        });
        setPrompts((current) => mergePromptHistory(current, result.prompt));
        setSetupReason(null);
      } catch (caught) {
        handleConsoleError(caught, "Prompt expiration update failed");
      }
    },
    [handleConsoleError],
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
    setupNeeded: setupReason !== null,
    setupReason,
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
