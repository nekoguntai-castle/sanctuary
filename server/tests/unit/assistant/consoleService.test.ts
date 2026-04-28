import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  actor,
  completedTrace,
  mocks,
  promptHistory,
  promptId,
  resetHappyPath,
  session,
  sessionId,
  toolDefinition,
  turn,
  turnId,
  walletId,
} from "./consoleService.testUtils";

import {
  clearPromptHistory,
  createConsoleSession,
  deleteConsoleSession,
  deletePromptHistory,
  listConsoleSessions,
  listConsoleTools,
  listConsoleTurns,
  listPromptHistory,
  purgeExpiredPromptHistory,
  replayPromptHistory,
  runConsoleTurn,
  updatePromptHistory,
} from "../../../src/assistant/console/service";
import { ServiceUnavailableError } from "../../../src/errors/ApiError";

describe("console service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHappyPath();
  });

  it("lists tools with admin availability applied", () => {
    mocks.assistantReadToolRegistry.list.mockReturnValue([
      toolDefinition(),
      toolDefinition({
        name: "get_admin_operational_summary",
        sensitivity: "admin",
        requiredScope: { kind: "admin", description: "admin scope" },
      }),
    ]);

    const nonAdminTools = listConsoleTools(actor(false));
    const adminTools = listConsoleTools(actor(true));

    expect(nonAdminTools).toEqual([
      expect.objectContaining({ name: "get_wallet_overview", available: true }),
      expect.objectContaining({
        name: "get_admin_operational_summary",
        available: false,
      }),
    ]);
    expect(adminTools[1]).toMatchObject({
      name: "get_admin_operational_summary",
      available: true,
    });
  });

  it("runs a turn through planning, scoped tool execution, synthesis, prompt history, and audit", async () => {
    const result = await runConsoleTurn(
      actor(),
      {
        prompt: "What is this wallet doing?",
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      },
      {
        ipAddress: "127.0.0.1",
        userAgent: "test-agent",
      },
    );

    expect(result.turn).toMatchObject({
      state: "completed",
      response: "answer",
    });
    expect(mocks.consoleRepository.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "What is this wallet doing?",
        normalizedPrompt: "what is this wallet doing?",
      }),
    );
    expect(mocks.assistantReadToolRegistry.execute).toHaveBeenCalledWith(
      "get_wallet_overview",
      { walletId },
      expect.objectContaining({
        source: "console",
        actor: expect.objectContaining({ userId: "user-1" }),
        walletScopeIds: [walletId],
      }),
    );
    expect(mocks.synthesizeConsoleAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        toolResults: [
          expect.objectContaining({
            toolName: "get_wallet_overview",
            input: { walletId },
            facts: { summary: "Wallet has activity." },
          }),
        ],
      }),
    );
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CONSOLE_TURN",
        category: "console",
        success: true,
        details: expect.objectContaining({
          toolCount: 1,
          tools: [
            expect.objectContaining({
              toolName: "get_wallet_overview",
              status: "completed",
            }),
          ],
        }),
        ipAddress: "127.0.0.1",
        userAgent: "test-agent",
      }),
    );
    expect(
      JSON.stringify(mocks.auditLog.mock.calls[0][0].details),
    ).not.toContain("What is this wallet doing?");
  });

  it("resolves auto context into an accessible wallet-set planning envelope", async () => {
    const secondWalletId = "55555555-5555-4555-8555-555555555555";
    mocks.walletRepository.findAccessibleWithSelect.mockResolvedValue([
      { id: secondWalletId, name: "Spending", network: "mainnet" },
      { id: walletId, name: "Main Vault", network: "mainnet" },
    ]);

    await runConsoleTurn(actor(), {
      prompt: "show transactions for this wallet",
      clientContext: { mode: "auto", routeWalletId: walletId },
      maxSensitivity: "wallet",
    });

    const expectedScope = {
      kind: "wallet_set",
      walletIds: [walletId, secondWalletId],
    };
    expect(mocks.consoleRepository.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expectedScope,
      }),
    );
    expect(mocks.planConsoleTools).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expectedScope,
        context: {
          mode: "auto",
          currentWalletId: walletId,
          currentWalletName: "Main Vault",
          wallets: [
            { id: walletId, name: "Main Vault", network: "mainnet" },
            { id: secondWalletId, name: "Spending", network: "mainnet" },
          ],
        },
      }),
    );
    expect(mocks.synthesizeConsoleAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          mode: "auto",
          currentWalletId: walletId,
        }),
      }),
    );
    expect(mocks.walletRepository.findByIdWithAccess).toHaveBeenCalledWith(
      walletId,
      "user-1",
    );
    expect(mocks.walletRepository.findByIdWithAccess).toHaveBeenCalledWith(
      secondWalletId,
      "user-1",
    );
  });

  it("caps auto context wallet sets and marks planner context when the wallet limit applies", async () => {
    const wallets = Array.from({ length: 30 }, (_, index) => ({
      id: `wallet-${index}`,
      name: `Wallet ${index}`,
      network: "mainnet",
    }));
    mocks.walletRepository.findAccessibleWithSelect.mockResolvedValue(wallets);
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await runConsoleTurn(actor(), {
      prompt: "summarize every wallet",
      clientContext: { mode: "auto" },
      maxSensitivity: "wallet",
    });

    expect(mocks.consoleRepository.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          kind: "wallet_set",
          walletIds: wallets.slice(0, 25).map((wallet) => wallet.id),
        },
      }),
    );
    expect(mocks.planConsoleTools).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          mode: "auto",
          wallets: wallets.slice(0, 25),
          walletLimitApplied: true,
        }),
      }),
    );
    expect(mocks.planConsoleTools.mock.calls[0][0].context).not.toHaveProperty(
      "currentWalletId",
    );
  });

  it("falls back to general auto context when the actor has no accessible wallets", async () => {
    mocks.walletRepository.findAccessibleWithSelect.mockResolvedValue([]);
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await runConsoleTurn(actor(), {
      prompt: "what is the current block?",
      clientContext: { mode: "auto" },
      maxSensitivity: "public",
    });

    expect(mocks.consoleRepository.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "general" },
        maxSensitivity: "public",
      }),
    );
    expect(mocks.planConsoleTools).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "general" },
        context: {
          mode: "auto",
          wallets: [],
        },
      }),
    );
  });

  it("stores a denied trace when a wallet-sensitive tool is requested without explicit wallet scope", async () => {
    mocks.planConsoleTools.mockResolvedValue({
      toolCalls: [{ name: "get_wallet_overview", input: { walletId } }],
      warnings: [],
    });
    mocks.consoleRepository.createToolTrace.mockImplementation(
      async (input: Record<string, unknown>) =>
        completedTrace({
          ...input,
          status: input.status,
          errorCode: input.errorCode,
        }),
    );

    const result = await runConsoleTurn(actor(), {
      prompt: "Tell me about my wallet",
      scope: { kind: "general" },
      maxSensitivity: "wallet",
    });

    expect(result.toolTraces[0]).toMatchObject({
      status: "denied",
      errorCode: "tool_denied",
      errorMessage: "Wallet-sensitive tools require an explicit wallet scope",
    });
    expect(mocks.assistantReadToolRegistry.execute).not.toHaveBeenCalled();
    expect(mocks.synthesizeConsoleAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        toolResults: [expect.objectContaining({ status: "denied" })],
      }),
    );
  });

  it("rejects wallet scoped sessions when the actor lacks wallet access", async () => {
    mocks.walletRepository.findByIdWithAccess.mockResolvedValue(null);

    await expect(
      createConsoleSession({
        actor: actor(),
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.consoleRepository.createSession).not.toHaveBeenCalled();
  });

  it("creates default-scope sessions when no wallet context is supplied", async () => {
    await expect(
      createConsoleSession({
        actor: actor(),
        maxSensitivity: "wallet",
        expiresAt: "2026-04-27T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ id: sessionId });

    expect(mocks.consoleRepository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        scope: { kind: "general" },
        maxSensitivity: "wallet",
        expiresAt: new Date("2026-04-27T00:00:00.000Z"),
      }),
    );

    await createConsoleSession({
      actor: actor(),
      maxSensitivity: "wallet",
    });
    expect(mocks.consoleRepository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: null,
      }),
    );
  });

  it("returns not found when a supplied turn session is missing", async () => {
    mocks.consoleRepository.findSessionForUser.mockResolvedValue(null);

    await expect(
      runConsoleTurn(actor(), {
        sessionId,
        prompt: "hello",
        scope: { kind: "general" },
        maxSensitivity: "wallet",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("accepts manual tool calls and applies the per-turn limit", async () => {
    const toolCalls = Array.from({ length: 6 }, (_, index) => ({
      name: "get_wallet_overview",
      input: { walletId },
      reason: `reason ${index}`,
    }));

    await runConsoleTurn(actor(), {
      prompt: "manual",
      scope: { kind: "wallet", walletId },
      maxSensitivity: "wallet",
      toolCalls,
    });

    expect(mocks.planConsoleTools).not.toHaveBeenCalled();
    expect(mocks.consoleRepository.updatePromptMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          "get_wallet_overview",
          "get_wallet_overview",
          "get_wallet_overview",
          "get_wallet_overview",
          "get_wallet_overview",
        ],
      }),
    );
    expect(mocks.consoleRepository.completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        plannedTools: expect.objectContaining({
          warnings: ["tool_call_limit_applied"],
        }),
      }),
    );
  });

  it("accepts manual tool calls within the limit without warnings", async () => {
    await runConsoleTurn(
      { userId: "user-1", isAdmin: false },
      {
        prompt: "manual",
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
        toolCalls: [{ name: "get_wallet_overview", input: { walletId } }],
      },
    );

    expect(mocks.consoleRepository.completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        plannedTools: expect.objectContaining({ warnings: [] }),
      }),
    );
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "user-1",
      }),
    );
  });

  it("runs turns with default scope when no scope is supplied", async () => {
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await runConsoleTurn(actor(), {
      prompt: "general question",
      maxSensitivity: "wallet",
    });

    expect(mocks.consoleRepository.createTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: "general" },
      }),
    );
  });

  it("replays stored prompts with validated stored scope and sensitivity fallbacks", async () => {
    mocks.consoleRepository.findPromptForUser.mockResolvedValue(
      promptHistory({
        scope: { kind: "unknown", walletId },
        maxSensitivity: "not-a-sensitivity",
      }),
    );
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await replayPromptHistory(actor(), promptId, {});

    expect(mocks.consoleRepository.markPromptReplayed).toHaveBeenCalledWith(
      promptId,
    );
    expect(mocks.consoleRepository.updateSessionScope).toHaveBeenCalledWith(
      sessionId,
      { kind: "general" },
      "wallet",
    );
  });

  it("deletes selected sessions through ownership checks", async () => {
    await expect(
      deleteConsoleSession(actor(), sessionId),
    ).resolves.toMatchObject({ id: sessionId });

    expect(mocks.consoleRepository.findSessionForUser).toHaveBeenCalledWith(
      sessionId,
      "user-1",
    );
    expect(mocks.consoleRepository.softDeleteSession).toHaveBeenCalledWith(
      sessionId,
    );
  });

  it("updates, deletes, clears, and purges prompt history through ownership checks", async () => {
    mocks.consoleRepository.findPromptForUser.mockResolvedValue(
      promptHistory(),
    );
    mocks.consoleRepository.updatePrompt.mockResolvedValue(
      promptHistory({ saved: true }),
    );
    mocks.consoleRepository.softDeletePrompt.mockResolvedValue(
      promptHistory({ deletedAt: new Date() }),
    );
    mocks.consoleRepository.softDeletePromptsForUser.mockResolvedValue(4);
    mocks.consoleRepository.purgeExpiredPromptHistory.mockResolvedValue(3);

    await expect(
      updatePromptHistory(actor(), promptId, { saved: true }),
    ).resolves.toMatchObject({ saved: true });
    await expect(deletePromptHistory(actor(), promptId)).resolves.toMatchObject(
      { id: promptId },
    );
    await expect(clearPromptHistory(actor())).resolves.toBe(4);
    await expect(
      purgeExpiredPromptHistory(new Date("2026-04-26T00:00:00.000Z")),
    ).resolves.toBe(3);

    expect(
      mocks.consoleRepository.softDeletePromptsForUser,
    ).toHaveBeenCalledWith("user-1");
  });

  it("lists sessions, turns, and prompt history through repository filters", async () => {
    const sessionRows = [session()];
    const turnRows = [{ ...turn(), toolTraces: [] }];
    const promptRows = [promptHistory()];
    mocks.consoleRepository.listSessions.mockResolvedValue(sessionRows);
    mocks.consoleRepository.listTurns.mockResolvedValue(turnRows);
    mocks.consoleRepository.listPrompts.mockResolvedValue(promptRows);

    await expect(listConsoleSessions(actor(), 10, 1)).resolves.toBe(
      sessionRows,
    );
    await expect(listConsoleTurns(actor(), sessionId, 50)).resolves.toBe(
      turnRows,
    );
    await expect(
      listPromptHistory(actor(), {
        limit: 20,
        offset: 5,
        search: "  Fee   Rate ",
        saved: true,
        includeExpired: true,
      }),
    ).resolves.toBe(promptRows);
    await expect(
      listPromptHistory(actor(), {
        limit: 20,
        offset: 0,
        saved: undefined,
        includeExpired: false,
      }),
    ).resolves.toBe(promptRows);

    expect(mocks.consoleRepository.listSessions).toHaveBeenCalledWith(
      "user-1",
      10,
      1,
    );
    expect(mocks.consoleRepository.listTurns).toHaveBeenCalledWith(
      sessionId,
      50,
    );
    expect(mocks.consoleRepository.listPrompts).toHaveBeenCalledWith(
      "user-1",
      { search: "fee rate", saved: true, includeExpired: true },
      20,
      5,
    );
    expect(mocks.consoleRepository.listPrompts).toHaveBeenCalledWith(
      "user-1",
      { search: undefined, saved: undefined, includeExpired: false },
      20,
      0,
    );
  });

  it("returns not found for missing sessions and prompts", async () => {
    mocks.consoleRepository.findSessionForUser.mockResolvedValue(null);
    await expect(listConsoleTurns(actor(), sessionId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      deleteConsoleSession(actor(), sessionId),
    ).rejects.toMatchObject({
      statusCode: 404,
    });

    mocks.consoleRepository.findPromptForUser.mockResolvedValue(null);
    await expect(
      updatePromptHistory(actor(), promptId, { saved: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(deletePromptHistory(actor(), promptId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      replayPromptHistory(actor(), promptId, {}),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("marks failed turns and audits when planning or synthesis fails", async () => {
    mocks.planConsoleTools.mockRejectedValue(new Error("model refused"));
    mocks.consoleRepository.failTurn.mockResolvedValue({
      ...turn(),
      state: "failed",
    });

    await expect(
      runConsoleTurn(actor(), {
        prompt: "fail this turn",
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      }),
    ).rejects.toThrow("model refused");

    expect(mocks.consoleRepository.failTurn).toHaveBeenCalledWith(turnId, {
      message: "model refused",
    });
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CONSOLE_TURN_FAILED",
        success: false,
        errorMsg: "model refused",
      }),
    );
  });

  it("normalizes non-error turn failures", async () => {
    mocks.planConsoleTools.mockRejectedValue("string failure");

    await expect(
      runConsoleTurn(actor(), {
        prompt: "fail with string",
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      }),
    ).rejects.toBe("string failure");

    expect(mocks.consoleRepository.failTurn).toHaveBeenCalledWith(turnId, {
      message: "Console turn failed",
    });
  });

  it("rethrows service unavailable failures after recording turn failure", async () => {
    mocks.planConsoleTools.mockResolvedValue({
      toolCalls: [],
      warnings: [],
      providerProfileId: "profile-1",
      model: "llama3.2",
    });
    mocks.synthesizeConsoleAnswer.mockRejectedValue(
      new ServiceUnavailableError("proxy unavailable"),
    );

    await expect(
      runConsoleTurn(actor(), {
        prompt: "fail synthesis",
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      }),
    ).rejects.toMatchObject({ statusCode: 503 });

    expect(mocks.consoleRepository.failTurn).toHaveBeenCalledWith(turnId, {
      message: "proxy unavailable",
    });
  });

  it("completes with tool facts when synthesis fails after tool execution", async () => {
    mocks.synthesizeConsoleAnswer.mockRejectedValue(
      new ServiceUnavailableError(
        "AI endpoint response did not include message content",
      ),
    );

    await runConsoleTurn(actor(), {
      prompt: "show wallet transactions",
      scope: { kind: "wallet", walletId },
      maxSensitivity: "wallet",
    });

    expect(mocks.consoleRepository.failTurn).not.toHaveBeenCalled();
    expect(mocks.consoleRepository.completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        response: expect.stringContaining("Wallet has activity."),
        providerProfileId: "profile-1",
        model: "llama3.2",
        plannedTools: {
          toolCalls: [
            {
              name: "get_wallet_overview",
              input: { walletId },
              reason: "Need wallet state",
            },
          ],
          warnings: ["synthesis_fallback_applied"],
        },
      }),
    );
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CONSOLE_TURN",
        success: true,
        details: expect.objectContaining({
          planningWarnings: ["synthesis_fallback_applied"],
        }),
      }),
    );
  });

  it("builds synthesis fallback summaries from trace errors and statuses", async () => {
    mocks.planConsoleTools.mockResolvedValue({
      toolCalls: [
        { name: "get_wallet_overview", input: { walletId } },
        { name: "get_wallet_overview", input: { walletId } },
      ],
      warnings: [],
      providerProfileId: "profile-1",
      model: "llama3.2",
    });
    mocks.consoleRepository.createToolTrace
      .mockResolvedValueOnce(
        completedTrace({
          facts: { summary: "   " },
          errorMessage: "scope denied",
        }),
      )
      .mockResolvedValueOnce(
        completedTrace({
          id: "trace-2",
          facts: null,
          errorMessage: null,
        }),
      );
    mocks.synthesizeConsoleAnswer.mockRejectedValue(
      new ServiceUnavailableError("synthesis unavailable"),
    );

    await runConsoleTurn(actor(), {
      prompt: "summarize traces",
      scope: { kind: "wallet", walletId },
      maxSensitivity: "wallet",
    });

    expect(mocks.consoleRepository.completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        response: expect.stringContaining("get_wallet_overview: scope denied"),
      }),
    );
    expect(mocks.consoleRepository.completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        response: expect.stringContaining("get_wallet_overview: completed"),
      }),
    );
  });

  it("replays stored prompts with explicit replay overrides", async () => {
    mocks.consoleRepository.findPromptForUser.mockResolvedValue(
      promptHistory({
        sessionId: null,
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      }),
    );
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await replayPromptHistory(actor(true), promptId, {
      sessionId,
      scope: { kind: "admin" },
      maxSensitivity: "admin",
      expiresAt: "2026-04-27T00:00:00.000Z",
    });

    expect(mocks.consoleRepository.updateSessionScope).toHaveBeenCalledWith(
      sessionId,
      { kind: "admin" },
      "admin",
    );
    expect(mocks.consoleRepository.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date("2026-04-27T00:00:00.000Z"),
      }),
    );
  });

  it("replays prompt history with auto context instead of the stored scope", async () => {
    mocks.consoleRepository.findPromptForUser.mockResolvedValue(
      promptHistory({
        scope: { kind: "wallet", walletId },
        maxSensitivity: "wallet",
      }),
    );
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await replayPromptHistory(actor(), promptId, {
      clientContext: { mode: "auto", routeWalletId: walletId },
    });

    expect(mocks.consoleRepository.updateSessionScope).toHaveBeenCalledWith(
      sessionId,
      { kind: "wallet_set", walletIds: [walletId] },
      "wallet",
    );
    expect(mocks.planConsoleTools).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          mode: "auto",
          currentWalletId: walletId,
        }),
      }),
    );
  });

  it("replays prompt history without a stored session when no override is supplied", async () => {
    mocks.consoleRepository.findPromptForUser.mockResolvedValue(
      promptHistory({ sessionId: null }),
    );
    mocks.planConsoleTools.mockResolvedValue({ toolCalls: [], warnings: [] });

    await replayPromptHistory(actor(), promptId, {});

    expect(mocks.consoleRepository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
      }),
    );
  });
});
