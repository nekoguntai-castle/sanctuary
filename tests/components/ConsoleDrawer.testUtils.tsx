import { render } from "@testing-library/react";
import { useEffect } from "react";
import type React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { ConsoleDrawer } from "../../components/ConsoleDrawer";
import * as consoleApi from "../../src/api/console";

export { consoleApi };

export const session = {
  id: "session-12345678",
  userId: "user-1",
  title: "Recent session",
  maxSensitivity: "wallet",
  createdAt: "2026-04-26T01:00:00.000Z",
  updatedAt: "2026-04-26T01:05:00.000Z",
};

export const promptHistory = {
  id: "prompt-1",
  userId: "user-1",
  sessionId: session.id,
  prompt: "How long ago was block 800000?",
  title: "Block age",
  maxSensitivity: "wallet",
  saved: false,
  expiresAt: null,
  replayCount: 0,
  lastReplayedAt: null,
  createdAt: "2026-04-26T01:00:00.000Z",
  updatedAt: "2026-04-26T01:00:00.000Z",
};

export const expiringPromptHistory = {
  ...promptHistory,
  id: "prompt-expiring",
  title: "",
  saved: true,
  expiresAt: "2026-05-26T01:00:00.000Z",
  updatedAt: "not-a-date",
};

export const completedTurn = {
  id: "turn-1",
  sessionId: session.id,
  promptHistoryId: promptHistory.id,
  state: "completed",
  prompt: "How long ago was block 800000?",
  response: "Block 800000 was mined about 2 years ago.",
  maxSensitivity: "wallet",
  createdAt: "2026-04-26T01:00:00.000Z",
  completedAt: "2026-04-26T01:00:02.000Z",
};

export const trace = {
  id: "trace-1",
  turnId: completedTurn.id,
  toolName: "read.block",
  status: "completed",
  sensitivity: "public",
  startedAt: "2026-04-26T01:00:00.000Z",
  completedAt: "2026-04-26T01:00:01.000Z",
  facts: { height: 800000 },
  provenance: [],
  redactions: [],
  truncation: null,
  errorMessage: null,
};

export const olderSession = {
  ...session,
  id: "session-older",
  title: "",
  updatedAt: "2026-04-26T00:30:00.000Z",
};

export const wallets = [
  { id: "wallet-1", name: "Main Vault", type: "single_sig" },
] as any;

export const multiWallets = [
  { id: "wallet-1", name: "Main Vault", type: "single_sig" },
  { id: "wallet-2", name: "Spending", type: "single_sig" },
] as any;

export function mockConsoleReadyState() {
  vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
    sessions: [],
  } as any);
  vi.mocked(consoleApi.listPromptHistory).mockResolvedValue({
    prompts: [promptHistory],
  } as any);
  vi.mocked(consoleApi.listConsoleTools).mockResolvedValue({
    tools: [
      {
        name: "read.block",
        title: "Read block",
        description: "Read block data",
        sensitivity: "public",
        requiredScope: "general",
        inputFields: ["height"],
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
  vi.mocked(consoleApi.deleteConsoleSession).mockResolvedValue({
    success: true,
  });
  vi.mocked(consoleApi.deletePromptHistory).mockResolvedValue({
    success: true,
  });
  vi.mocked(consoleApi.clearPromptHistory).mockResolvedValue({
    success: true,
    deleted: 1,
  });
}

export function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof ConsoleDrawer>> = {},
  options: {
    route?: string;
    onLocationChange?: (location: ReturnType<typeof useLocation>) => void;
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={[options.route ?? "/"]}>
      <ConsoleDrawer
        isOpen
        onClose={vi.fn()}
        wallets={wallets}
        isAdmin
        {...overrides}
      />
      {options.onLocationChange ? (
        <LocationProbe onChange={options.onLocationChange} />
      ) : null}
    </MemoryRouter>,
  );
}

function LocationProbe({
  onChange,
}: {
  onChange: (location: ReturnType<typeof useLocation>) => void;
}) {
  const location = useLocation();
  useEffect(() => onChange(location), [location, onChange]);
  return null;
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
