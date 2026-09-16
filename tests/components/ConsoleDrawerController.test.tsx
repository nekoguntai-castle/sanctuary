import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConsoleDrawerController } from "../../src/components/ConsoleDrawer/useConsoleDrawerController";
import * as consoleApi from "../../src/api/console";
import { createDeferred } from "./ConsoleDrawer.testUtils";

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

function makeTurn(sessionId: string) {
  return {
    id: `turn-${sessionId}`,
    sessionId,
    promptHistoryId: `prompt-${sessionId}`,
    state: "completed",
    prompt: `prompt for ${sessionId}`,
    response: `response for ${sessionId}`,
    maxSensitivity: "high",
    createdAt: "2026-04-26T01:00:00.000Z",
    completedAt: "2026-04-26T01:00:01.000Z",
  };
}

function installBaseConsoleMocks() {
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
}

describe("useConsoleDrawerController", () => {
  beforeEach(() => {
    installBaseConsoleMocks();
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

  describe("session switch races", () => {
    // Nested function declaration: lizard only splits the describe callback
    // into per-test functions when one is present; keep it.
    function turnFor(sessionId: string) {
      return makeTurn(sessionId);
    }

    it("keeps B's messages when A's load resolves after B was selected", async () => {
      const deferredA = createDeferred<{ turns: unknown[] }>();
      const deferredB = createDeferred<{ turns: unknown[] }>();
      vi.mocked(consoleApi.listConsoleTurns).mockImplementation(
        (sessionId: string) => {
          if (sessionId === "session-a") return deferredA.promise as any;
          if (sessionId === "session-b") return deferredB.promise as any;
          return Promise.resolve({ turns: [] }) as any;
        },
      );

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

      let selectA: Promise<void> = Promise.resolve();
      await act(async () => {
        selectA = result.current.selectSession("session-a");
      });

      let selectB: Promise<void> = Promise.resolve();
      await act(async () => {
        selectB = result.current.selectSession("session-b");
      });

      expect(result.current.selectedSessionId).toBe("session-b");

      await act(async () => {
        deferredB.resolve({ turns: [turnFor("session-b")] });
        await selectB;
      });

      expect(
        result.current.messages.map((message) => message.content),
      ).toEqual(["prompt for session-b", "response for session-b"]);

      await act(async () => {
        deferredA.resolve({ turns: [turnFor("session-a")] });
        await selectA;
      });

      expect(result.current.selectedSessionId).toBe("session-b");
      expect(
        result.current.messages.map((message) => message.content),
      ).toEqual(["prompt for session-b", "response for session-b"]);
    });

    it("targets B for sendPrompt after selecting A then B while A is pending", async () => {
      const deferredA = createDeferred<{ turns: unknown[] }>();
      vi.mocked(consoleApi.listConsoleTurns).mockImplementation(
        (sessionId: string) => {
          if (sessionId === "session-a") return deferredA.promise as any;
          return Promise.resolve({ turns: [] }) as any;
        },
      );
      vi.mocked(consoleApi.runConsoleTurn).mockResolvedValue({
        session,
        promptHistory,
        turn,
        toolTraces: [],
      } as any);

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
        void result.current.selectSession("session-a");
      });
      await act(async () => {
        void result.current.selectSession("session-b");
      });

      expect(result.current.selectedSessionId).toBe("session-b");

      act(() => {
        result.current.setInput("hello");
      });

      await act(async () => {
        await result.current.sendPrompt();
      });

      expect(consoleApi.runConsoleTurn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-b" }),
      );
    });

    it("ignores an error from a superseded session load", async () => {
      const deferredA = createDeferred<{ turns: unknown[] }>();
      const deferredB = createDeferred<{ turns: unknown[] }>();
      vi.mocked(consoleApi.listConsoleTurns).mockImplementation(
        (sessionId: string) => {
          if (sessionId === "session-a") return deferredA.promise as any;
          if (sessionId === "session-b") return deferredB.promise as any;
          return Promise.resolve({ turns: [] }) as any;
        },
      );

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

      let selectA: Promise<void> = Promise.resolve();
      await act(async () => {
        selectA = result.current.selectSession("session-a");
      });

      let selectB: Promise<void> = Promise.resolve();
      await act(async () => {
        selectB = result.current.selectSession("session-b");
      });

      await act(async () => {
        deferredB.resolve({ turns: [turnFor("session-b")] });
        await selectB;
      });

      await act(async () => {
        deferredA.reject(new Error("stale session load failed"));
        await selectA;
      });

      expect(result.current.error).toBeNull();
      expect(result.current.selectedSessionId).toBe("session-b");
      expect(
        result.current.messages.map((message) => message.content),
      ).toEqual(["prompt for session-b", "response for session-b"]);
    });
  });
});

describe("useConsoleDrawerController in-flight turn results after a session switch", () => {
  // See the note in "session switch races": the nested declaration keeps
  // lizard's per-function accounting intact.
  function turnFor(sessionId: string) {
    return makeTurn(sessionId);
  }

  const turnsBySession: Record<string, unknown[]> = {
    "session-1": [],
    "session-a": [],
    "session-b": [turnFor("session-b")],
  };
  const sessionBTranscript = ["prompt for session-b", "response for session-b"];
  const resultForSessionA = () => ({
    session: { ...session, id: "session-a" },
    promptHistory,
    turn: turnFor("session-a"),
    toolTraces: [],
  });

  const renderReadyController = async () => {
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
    return result;
  };

  const contentsOf = (
    result: { current: { messages: Array<{ content: string }> } },
  ) => result.current.messages.map((message) => message.content);

  beforeEach(() => {
    installBaseConsoleMocks();
    vi.mocked(consoleApi.listConsoleTurns).mockImplementation(
      (sessionId: string) =>
        Promise.resolve({ turns: turnsBySession[sessionId] }) as any,
    );
  });

  it("applies sendPrompt result to the same session when no switch occurs", async () => {
    vi.mocked(consoleApi.runConsoleTurn).mockResolvedValue({
      session,
      promptHistory,
      turn,
      toolTraces: [],
    } as any);
    const result = await renderReadyController();

    act(() => {
      result.current.setInput("hello");
    });
    await act(async () => {
      await result.current.sendPrompt();
    });

    expect(result.current.selectedSessionId).toBe("session-1");
    expect(contentsOf(result)).toEqual(["high sensitivity prompt", "retried"]);
  });

  it("keeps B's messages when A's sendPrompt resolves after B was selected", async () => {
    const deferredSend = createDeferred<any>();
    vi.mocked(consoleApi.runConsoleTurn).mockReturnValueOnce(deferredSend.promise);
    const result = await renderReadyController();

    await act(async () => {
      await result.current.selectSession("session-a");
    });
    act(() => {
      result.current.setInput("hello from a");
    });
    let sendA: Promise<void> = Promise.resolve();
    await act(async () => {
      sendA = result.current.sendPrompt();
    });
    await act(async () => {
      await result.current.selectSession("session-b");
    });

    expect(result.current.selectedSessionId).toBe("session-b");
    expect(contentsOf(result)).toEqual(sessionBTranscript);

    await act(async () => {
      deferredSend.resolve(resultForSessionA());
      await sendA;
    });

    expect(result.current.selectedSessionId).toBe("session-b");
    expect(contentsOf(result)).toEqual(sessionBTranscript);
  });

  it("does not append a failed message into B after A's sendPrompt rejects", async () => {
    const deferredSend = createDeferred<any>();
    vi.mocked(consoleApi.runConsoleTurn).mockReturnValueOnce(deferredSend.promise);
    const result = await renderReadyController();

    await act(async () => {
      await result.current.selectSession("session-a");
    });
    act(() => {
      result.current.setInput("hello from a");
    });
    let sendA: Promise<void> = Promise.resolve();
    await act(async () => {
      sendA = result.current.sendPrompt();
    });
    await act(async () => {
      await result.current.selectSession("session-b");
    });
    await act(async () => {
      deferredSend.reject(new Error("boom"));
      await sendA;
    });

    expect(result.current.selectedSessionId).toBe("session-b");
    expect(contentsOf(result)).toEqual(sessionBTranscript);
  });

  it("keeps B's messages when A's replayPrompt resolves after B was selected", async () => {
    const deferredReplay = createDeferred<any>();
    vi.mocked(consoleApi.replayPromptHistory).mockReturnValueOnce(deferredReplay.promise);
    const result = await renderReadyController();

    await act(async () => {
      await result.current.selectSession("session-a");
    });
    let replayA: Promise<void> = Promise.resolve();
    await act(async () => {
      replayA = result.current.replayPrompt("prompt-1");
    });
    await act(async () => {
      await result.current.selectSession("session-b");
    });

    expect(result.current.selectedSessionId).toBe("session-b");
    expect(contentsOf(result)).toEqual(sessionBTranscript);

    await act(async () => {
      deferredReplay.resolve(resultForSessionA());
      await replayA;
    });

    expect(result.current.selectedSessionId).toBe("session-b");
    expect(contentsOf(result)).toEqual(sessionBTranscript);
  });
});
