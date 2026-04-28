import { vi } from "vitest";

export const walletId = "11111111-1111-4111-8111-111111111111";
export const sessionId = "22222222-2222-4222-8222-222222222222";
export const turnId = "33333333-3333-4333-8333-333333333333";
export const promptId = "44444444-4444-4444-8444-444444444444";

const hoistedMocks = vi.hoisted(() => {
  class MockAssistantToolError extends Error {
    statusCode: number;
    code: string;

    constructor(
      statusCode: number,
      message: string,
      code = "assistant_tool_error",
    ) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    AssistantToolError: MockAssistantToolError,
    assistantReadToolRegistry: {
      list: vi.fn(),
      get: vi.fn(),
      execute: vi.fn(),
    },
    consoleRepository: {
      createSession: vi.fn(),
      findSessionForUser: vi.fn(),
      listSessions: vi.fn(),
      softDeleteSession: vi.fn(),
      softDeletePromptsForUser: vi.fn(),
      updateSessionScope: vi.fn(),
      createTurn: vi.fn(),
      updateTurnState: vi.fn(),
      completeTurn: vi.fn(),
      failTurn: vi.fn(),
      listTurns: vi.fn(),
      createPrompt: vi.fn(),
      attachPromptToTurn: vi.fn(),
      updatePromptMetadata: vi.fn(),
      listPrompts: vi.fn(),
      findPromptForUser: vi.fn(),
      updatePrompt: vi.fn(),
      softDeletePrompt: vi.fn(),
      markPromptReplayed: vi.fn(),
      createToolTrace: vi.fn(),
      purgeExpiredPromptHistory: vi.fn(),
    },
    walletRepository: {
      findByIdWithAccess: vi.fn(),
      findAccessibleWithSelect: vi.fn(),
    },
    planConsoleTools: vi.fn(),
    synthesizeConsoleAnswer: vi.fn(),
    auditLog: vi.fn(),
  };
});

vi.mock("../../../src/assistant/tools", () => ({
  AssistantToolError: hoistedMocks.AssistantToolError,
  assistantReadToolRegistry: hoistedMocks.assistantReadToolRegistry,
}));

vi.mock("../../../src/repositories", () => ({
  consoleRepository: hoistedMocks.consoleRepository,
  walletRepository: hoistedMocks.walletRepository,
}));

vi.mock("../../../src/assistant/console/modelGateway", () => ({
  planConsoleTools: hoistedMocks.planConsoleTools,
  synthesizeConsoleAnswer: hoistedMocks.synthesizeConsoleAnswer,
}));

vi.mock("../../../src/services/auditService", () => ({
  AuditAction: {
    CONSOLE_TURN: "CONSOLE_TURN",
    CONSOLE_TURN_FAILED: "CONSOLE_TURN_FAILED",
  },
  AuditCategory: { CONSOLE: "console" },
  auditService: { log: hoistedMocks.auditLog },
}));

export const mocks = hoistedMocks;

export function actor(isAdmin = false) {
  return { userId: "user-1", username: "alice", isAdmin };
}

export function toolDefinition(overrides: Record<string, unknown> = {}) {
  return {
    name: "get_wallet_overview",
    title: "Wallet overview",
    description: "Read wallet overview",
    sensitivity: "wallet",
    requiredScope: {
      kind: "wallet",
      description: "wallet scope",
      walletIdInput: "walletId",
    },
    inputSchema: { walletId: {} },
    budgets: { maxRows: 5, maxBytes: 4096 },
    ...overrides,
  };
}

export function session(scope: unknown = { kind: "wallet", walletId }) {
  return {
    id: sessionId,
    userId: "user-1",
    title: null,
    scope,
    maxSensitivity: "wallet",
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function turn() {
  return {
    id: turnId,
    sessionId,
    promptHistoryId: null,
    prompt: "What is this wallet doing?",
    response: null,
    scope: { kind: "wallet", walletId },
    maxSensitivity: "wallet",
    state: "accepted",
    plannedTools: null,
    providerProfileId: null,
    model: null,
    error: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function promptHistory(overrides: Record<string, unknown> = {}) {
  return {
    id: promptId,
    userId: "user-1",
    sessionId,
    turnId,
    prompt: "What is this wallet doing?",
    normalizedPrompt: "what is this wallet doing?",
    scope: { kind: "wallet", walletId },
    maxSensitivity: "wallet",
    tools: null,
    providerProfileId: null,
    model: null,
    saved: false,
    title: null,
    tags: null,
    expiresAt: null,
    replayCount: 0,
    lastReplayedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function completedTrace(overrides: Record<string, unknown> = {}) {
  return {
    id: "trace-1",
    turnId,
    toolName: "get_wallet_overview",
    status: "completed",
    input: { walletId },
    facts: { summary: "Wallet has activity." },
    provenance: { source: "sanctuary" },
    redactions: ["device_fingerprints"],
    truncation: { truncated: false },
    warnings: [],
    sensitivity: "wallet",
    rowCount: 1,
    walletCount: 1,
    durationMs: 10,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    ...overrides,
  };
}

export function resetHappyPath() {
  mocks.walletRepository.findByIdWithAccess.mockResolvedValue({ id: walletId });
  mocks.walletRepository.findAccessibleWithSelect.mockResolvedValue([
    { id: walletId, name: "Main Vault", network: "mainnet" },
  ]);
  mocks.consoleRepository.createSession.mockResolvedValue(session());
  mocks.consoleRepository.findSessionForUser.mockResolvedValue(session());
  mocks.consoleRepository.updateSessionScope.mockResolvedValue(session());
  mocks.consoleRepository.softDeleteSession.mockResolvedValue(
    session({ kind: "general" }),
  );
  mocks.consoleRepository.softDeletePromptsForUser.mockResolvedValue(2);
  mocks.consoleRepository.createTurn.mockResolvedValue(turn());
  mocks.consoleRepository.updateTurnState.mockResolvedValue(turn());
  mocks.consoleRepository.attachPromptToTurn.mockResolvedValue(turn());
  mocks.consoleRepository.createPrompt.mockResolvedValue(promptHistory());
  mocks.consoleRepository.completeTurn.mockResolvedValue({
    ...turn(),
    state: "completed",
    response: "answer",
  });
  mocks.consoleRepository.updatePromptMetadata.mockResolvedValue(
    promptHistory(),
  );
  mocks.consoleRepository.createToolTrace.mockImplementation(
    async (input: Record<string, unknown>) => completedTrace(input),
  );
  mocks.assistantReadToolRegistry.list.mockReturnValue([toolDefinition()]);
  mocks.assistantReadToolRegistry.get.mockReturnValue(toolDefinition());
  mocks.assistantReadToolRegistry.execute.mockResolvedValue({
    data: { walletId },
    facts: { summary: "Wallet has activity." },
    provenance: { source: "sanctuary" },
    redactions: ["device_fingerprints"],
    truncation: { truncated: false },
    warnings: [],
    sensitivity: "wallet",
    audit: { rowCount: 1, walletCount: 1, durationMs: 10 },
  });
  mocks.planConsoleTools.mockResolvedValue({
    toolCalls: [
      {
        name: "get_wallet_overview",
        input: { walletId },
        reason: "Need wallet state",
      },
    ],
    warnings: [],
    providerProfileId: "profile-1",
    model: "llama3.2",
  });
  mocks.synthesizeConsoleAnswer.mockResolvedValue({
    response: "answer",
    providerProfileId: "profile-1",
    model: "llama3.2",
  });
}
