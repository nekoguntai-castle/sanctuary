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
        (error?.response?.reason === "provider_not_configured" ||
          error?.response?.reason === "provider_config_sync_failed" ||
          error?.response?.details?.reason === "provider_not_configured" ||
          error?.response?.details?.reason === "provider_config_sync_failed" ||
          error?.response?.reason === "not_configured" ||
          error?.response?.details?.reason === "not_configured" ||
          (typeof error?.message === "string" &&
            error.message.includes("AI provider is not configured")))
      ) {
        return "provider-setup";
      }
      if (
        error?.status === 503 &&
        typeof error?.message === "string" &&
        error.message.includes("AI provider configuration could not be synced")
      ) {
        return "provider-setup";
      }
      return null;
    }),
  };
}
