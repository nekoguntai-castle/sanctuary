import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConsoleDrawerController } from "../../components/ConsoleDrawer/useConsoleDrawerController";
import * as consoleApi from "../../src/api/console";

vi.mock("../../src/api/console", () => ({
  listConsoleTools: vi.fn(),
  listConsoleSessions: vi.fn(),
  listConsoleTurns: vi.fn(),
  deleteConsoleSession: vi.fn(),
  runConsoleTurn: vi.fn(),
  listPromptHistory: vi.fn(),
  clearPromptHistory: vi.fn(),
  updatePromptHistory: vi.fn(),
  deletePromptHistory: vi.fn(),
  replayPromptHistory: vi.fn(),
  getConsoleSetupReason: vi.fn(() => null),
}));

const wallets = [
  { id: "wallet-1", name: "Main Vault", type: "single_sig" },
] as any;

const session = {
  id: "session-1",
  userId: "user-1",
  maxSensitivity: "high",
  createdAt: "2026-04-26T01:00:00.000Z",
  updatedAt: "2026-04-26T01:00:00.000Z",
};

const promptHistory = {
  id: "prompt-1",
  userId: "user-1",
  prompt: "high sensitivity prompt",
  maxSensitivity: "high",
  saved: false,
  replayCount: 1,
  createdAt: "2026-04-26T01:00:00.000Z",
  updatedAt: "2026-04-26T01:00:00.000Z",
};

const turn = {
  id: "turn-1",
  sessionId: "session-1",
  promptHistoryId: "prompt-1",
  state: "completed",
  prompt: "high sensitivity prompt",
  response: "retried",
  maxSensitivity: "high",
  createdAt: "2026-04-26T01:00:00.000Z",
  completedAt: "2026-04-26T01:00:01.000Z",
};

function mockReplayResult() {
  vi.mocked(consoleApi.replayPromptHistory).mockResolvedValue({
    session,
    promptHistory,
    turn,
    toolTraces: [],
  } as any);
}

describe("useConsoleDrawerController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consoleApi.listConsoleSessions).mockResolvedValue({
      sessions: [],
    } as any);
    vi.mocked(consoleApi.listPromptHistory).mockResolvedValue({
      prompts: [],
    } as any);
    vi.mocked(consoleApi.listConsoleTools).mockResolvedValue({
      tools: [],
    } as any);
    vi.mocked(consoleApi.listConsoleTurns).mockResolvedValue({
      turns: [],
    } as any);
  });

  it("clears display state without deleting when no Console session is selected", async () => {
    const { result } = renderHook(() =>
      useConsoleDrawerController({
        isOpen: true,
        wallets,
        selectedNetwork: "mainnet",
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.clearSelectedSession();
    });

    expect(consoleApi.deleteConsoleSession).not.toHaveBeenCalled();
    expect(result.current.selectedSessionId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("raises access and replays a prompt with the raised sensitivity", async () => {
    mockReplayResult();
    const { result } = renderHook(() =>
      useConsoleDrawerController({
        isOpen: true,
        wallets,
        selectedNetwork: "mainnet",
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setMaxSensitivity("public");
    });
    expect(result.current.maxSensitivity).toBe("public");

    await act(async () => {
      await result.current.raiseAccessAndReplay("prompt-1");
    });

    expect(result.current.maxSensitivity).toBe("high");
    expect(consoleApi.replayPromptHistory).toHaveBeenCalledWith("prompt-1", {
      clientContext: { mode: "auto", selectedNetwork: "mainnet" },
      maxSensitivity: "high",
      sessionId: undefined,
    });
  });

  it("clamps admin sensitivity for non-admin users", async () => {
    const { result } = renderHook(() =>
      useConsoleDrawerController({
        isOpen: true,
        wallets,
        selectedNetwork: "mainnet",
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setMaxSensitivity("admin");
    });

    expect(result.current.maxSensitivity).toBe("high");
  });

  it("ignores raise-and-replay when no prompt id is available", async () => {
    const { result } = renderHook(() =>
      useConsoleDrawerController({
        isOpen: true,
        wallets,
        selectedNetwork: "mainnet",
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.raiseAccessAndReplay(null);
    });

    expect(consoleApi.replayPromptHistory).not.toHaveBeenCalled();
  });

  it("replays high access without escalation for non-admin users", async () => {
    mockReplayResult();
    const { result } = renderHook(() =>
      useConsoleDrawerController({
        isOpen: true,
        wallets,
        selectedNetwork: "mainnet",
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setMaxSensitivity("high");
    });

    await act(async () => {
      await result.current.raiseAccessAndReplay("prompt-1");
    });

    expect(result.current.maxSensitivity).toBe("high");
    expect(consoleApi.replayPromptHistory).toHaveBeenCalledWith("prompt-1", {
      clientContext: { mode: "auto", selectedNetwork: "mainnet" },
      maxSensitivity: "high",
      sessionId: undefined,
    });
  });

  it("raises high access to admin for admin users", async () => {
    mockReplayResult();
    const { result } = renderHook(() =>
      useConsoleDrawerController({
        isOpen: true,
        wallets,
        selectedNetwork: "mainnet",
        isAdmin: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setMaxSensitivity("high");
    });

    await act(async () => {
      await result.current.raiseAccessAndReplay("prompt-1");
    });

    expect(result.current.maxSensitivity).toBe("admin");
    expect(consoleApi.replayPromptHistory).toHaveBeenCalledWith("prompt-1", {
      clientContext: { mode: "auto", selectedNetwork: "mainnet" },
      maxSensitivity: "admin",
      sessionId: undefined,
    });
  });
});
