import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../src/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public response?: Record<string, unknown>,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

import {
  createConsoleSession,
  deletePromptHistory,
  getConsoleSetupReason,
  isConsoleFeatureDisabledError,
  isConsoleProviderSetupError,
  listConsoleSessions,
  listConsoleTools,
  listConsoleTurns,
  listPromptHistory,
  replayPromptHistory,
  runConsoleTurn,
  updatePromptHistory,
} from "../../src/api/console";
import { ApiError } from "../../src/api/client";

describe("Console API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls read endpoints with encoded identifiers and query params", async () => {
    mockGet.mockResolvedValue({});

    await listConsoleTools();
    await listConsoleSessions();
    await listConsoleSessions(5, 10);
    await listConsoleTurns("session/with slash");
    await listPromptHistory();
    await listPromptHistory({
      limit: 7,
      offset: 2,
      search: "block age",
      saved: true,
      includeExpired: false,
    });

    expect(mockGet).toHaveBeenCalledWith("/console/tools");
    expect(mockGet).toHaveBeenCalledWith("/console/sessions", {
      limit: 20,
      offset: 0,
    });
    expect(mockGet).toHaveBeenCalledWith("/console/sessions", {
      limit: 5,
      offset: 10,
    });
    expect(mockGet).toHaveBeenCalledWith(
      "/console/sessions/session%2Fwith%20slash/turns",
    );
    expect(mockGet).toHaveBeenCalledWith("/console/prompts", {
      limit: undefined,
      offset: undefined,
      search: undefined,
      saved: undefined,
      includeExpired: undefined,
    });
    expect(mockGet).toHaveBeenCalledWith("/console/prompts", {
      limit: 7,
      offset: 2,
      search: "block age",
      saved: true,
      includeExpired: false,
    });
  });

  it("calls session and turn mutation endpoints without retrying model-backed writes", async () => {
    mockPost.mockResolvedValue({});

    await createConsoleSession();
    await createConsoleSession({
      title: "Wallet questions",
      scope: { kind: "wallet", walletId: "wallet-1" },
      maxSensitivity: "high",
      expiresAt: "2026-05-26T00:00:00.000Z",
    });
    await runConsoleTurn({ prompt: "How old is block 800000?" });
    await runConsoleTurn({
      sessionId: "session-1",
      prompt: "Summarize wallet",
      scope: { kind: "wallet", walletId: "wallet-1" },
      maxSensitivity: "high",
      expiresAt: "2026-05-26T00:00:00.000Z",
    });
    await runConsoleTurn({
      prompt: "Show this wallet activity",
      clientContext: { mode: "auto", routeWalletId: "wallet-1" },
    });

    expect(mockPost).toHaveBeenCalledWith(
      "/console/sessions",
      {},
      { retry: { enabled: false } },
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/console/sessions",
      {
        title: "Wallet questions",
        scope: { kind: "wallet", walletId: "wallet-1" },
        maxSensitivity: "high",
        expiresAt: "2026-05-26T00:00:00.000Z",
      },
      { retry: { enabled: false } },
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/console/turns",
      {
        maxSensitivity: "wallet",
        prompt: "How old is block 800000?",
      },
      { retry: { enabled: false }, timeoutMs: 300000 },
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/console/turns",
      {
        maxSensitivity: "high",
        sessionId: "session-1",
        prompt: "Summarize wallet",
        scope: { kind: "wallet", walletId: "wallet-1" },
        expiresAt: "2026-05-26T00:00:00.000Z",
      },
      { retry: { enabled: false }, timeoutMs: 300000 },
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/console/turns",
      {
        maxSensitivity: "wallet",
        prompt: "Show this wallet activity",
        clientContext: { mode: "auto", routeWalletId: "wallet-1" },
      },
      { retry: { enabled: false }, timeoutMs: 300000 },
    );
  });

  it("calls prompt history mutation endpoints with encoded prompt ids", async () => {
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});
    mockPost.mockResolvedValue({});

    await updatePromptHistory("prompt/1", {
      saved: true,
      title: "Good block prompt",
      expiresAt: null,
    });
    await deletePromptHistory("prompt/1");
    await replayPromptHistory("prompt/1");
    await replayPromptHistory("prompt/1", {
      sessionId: "session-1",
      scope: { kind: "general" },
      maxSensitivity: "wallet",
    });
    await replayPromptHistory("prompt/1", {
      clientContext: { mode: "auto", routeWalletId: "wallet-1" },
    });

    expect(mockPatch).toHaveBeenCalledWith(
      "/console/prompts/prompt%2F1",
      {
        saved: true,
        title: "Good block prompt",
        expiresAt: null,
      },
      { enabled: false },
    );
    expect(mockDelete).toHaveBeenCalledWith(
      "/console/prompts/prompt%2F1",
      undefined,
      { enabled: false },
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/console/prompts/prompt%2F1/replay",
      {},
      { retry: { enabled: false }, timeoutMs: 300000 },
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/console/prompts/prompt%2F1/replay",
      {
        sessionId: "session-1",
        scope: { kind: "general" },
        maxSensitivity: "wallet",
      },
      { retry: { enabled: false }, timeoutMs: 300000 },
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/console/prompts/prompt%2F1/replay",
      {
        clientContext: { mode: "auto", routeWalletId: "wallet-1" },
      },
      { retry: { enabled: false }, timeoutMs: 300000 },
    );
  });

  it("classifies Console setup errors by missing prerequisite", () => {
    const featureError = new ApiError("Console is disabled", 403, {
      feature: "sanctuaryConsole",
    });
    const providerError = new ApiError(
      "AI provider is not configured for Sanctuary Console",
      503,
    );

    expect(isConsoleFeatureDisabledError(featureError)).toBe(true);
    expect(isConsoleProviderSetupError(providerError)).toBe(true);
    expect(getConsoleSetupReason(featureError)).toBe("feature-disabled");
    expect(getConsoleSetupReason(providerError)).toBe("provider-setup");
    expect(getConsoleSetupReason(new ApiError("Denied", 403))).toBeNull();
  });
});
