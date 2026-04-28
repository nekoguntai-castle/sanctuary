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
});
