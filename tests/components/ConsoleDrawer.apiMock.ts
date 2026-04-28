import { vi } from "vitest";

export function createConsoleApiMock() {
  return {
    listConsoleTools: vi.fn(),
    listConsoleSessions: vi.fn(),
    createConsoleSession: vi.fn(),
    listConsoleTurns: vi.fn(),
    deleteConsoleSession: vi.fn(),
    runConsoleTurn: vi.fn(),
    listPromptHistory: vi.fn(),
    clearPromptHistory: vi.fn(),
    updatePromptHistory: vi.fn(),
    deletePromptHistory: vi.fn(),
    replayPromptHistory: vi.fn(),
    getConsoleSetupReason: vi.fn((error: any) => {
      if (
        error?.status === 403 &&
        error?.response?.feature === "sanctuaryConsole"
      ) {
        return "feature-disabled";
      }
      if (
        error?.status === 503 &&
        typeof error?.message === "string" &&
        error.message.includes("AI provider is not configured")
      ) {
        return "provider-setup";
      }
      return null;
    }),
  };
}
