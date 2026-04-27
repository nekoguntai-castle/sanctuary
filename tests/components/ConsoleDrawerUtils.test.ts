import { describe, expect, it } from "vitest";
import {
  ALL_WALLETS_SCOPE_ID,
  AUTO_CONTEXT_ID,
  appendFailedAssistantMessage,
  appendPendingPrompt,
  appendTurnResult,
  buildConsoleClientContext,
  buildConsoleScope,
  buildWalletSetScopeIds,
  compressConsoleMessages,
  dedupePromptHistory,
  formatShortDate,
  GENERAL_SCOPE_ID,
  MAX_WALLET_SET_SCOPE_WALLETS,
  getErrorDetails,
  getErrorMessage,
  getPromptTitle,
  getScopeLabel,
  getTurnDetails,
  isConsoleSetupError,
  mergePromptHistory,
  mergeSession,
  replacePendingPromptWithTurnResult,
  sortSessionsByUpdatedAt,
  summarizeTrace,
  turnsToMessages,
} from "../../components/ConsoleDrawer/consoleDrawerUtils";
import { ApiError } from "../../src/api/client";
import type {
  ConsolePromptHistory,
  ConsoleSession,
  ConsoleToolTrace,
  ConsoleTurn,
} from "../../src/api/console";

const baseSession: ConsoleSession = {
  id: "session-a",
  userId: "user-1",
  title: "Session A",
  maxSensitivity: "wallet",
  createdAt: "2026-04-26T01:00:00.000Z",
  updatedAt: "2026-04-26T01:00:00.000Z",
};

const basePrompt: ConsolePromptHistory = {
  id: "prompt-a",
  userId: "user-1",
  sessionId: baseSession.id,
  prompt: "Prompt body",
  title: null,
  maxSensitivity: "wallet",
  saved: false,
  expiresAt: null,
  replayCount: 0,
  lastReplayedAt: null,
  createdAt: "2026-04-26T01:00:00.000Z",
  updatedAt: "2026-04-26T01:00:00.000Z",
};

const baseTrace: ConsoleToolTrace = {
  id: "trace-a",
  turnId: "turn-a",
  toolName: "wallet.summary",
  status: "completed",
  sensitivity: "wallet",
  createdAt: "2026-04-26T01:00:00.000Z",
  facts: { balance: 1, labels: ["cold"], nested: { count: 2 } },
  provenance: {},
  errorMessage: null,
};

const baseTurn: ConsoleTurn = {
  id: "turn-a",
  sessionId: baseSession.id,
  promptHistoryId: basePrompt.id,
  state: "completed",
  prompt: "Prompt body",
  response: "Response body",
  maxSensitivity: "wallet",
  createdAt: "2026-04-26T01:00:00.000Z",
  completedAt: "2026-04-26T01:00:02.000Z",
  toolTraces: [baseTrace],
};

describe("console drawer utilities", () => {
  it("builds labels, scopes, prompt titles, and error messages", () => {
    expect(buildConsoleClientContext(AUTO_CONTEXT_ID)).toEqual({
      mode: "auto",
    });
    expect(buildConsoleClientContext(AUTO_CONTEXT_ID, "wallet-1")).toEqual({
      mode: "auto",
      routeWalletId: "wallet-1",
    });
    expect(buildConsoleClientContext(GENERAL_SCOPE_ID)).toBeUndefined();
    expect(buildConsoleScope(AUTO_CONTEXT_ID)).toEqual({ kind: "general" });
    expect(buildConsoleScope(GENERAL_SCOPE_ID)).toEqual({ kind: "general" });
    expect(buildConsoleScope("wallet-1")).toEqual({
      kind: "wallet",
      walletId: "wallet-1",
    });
    expect(
      buildConsoleScope(ALL_WALLETS_SCOPE_ID, [
        { id: "wallet-1", name: "Vault" } as any,
        { id: "wallet-2", name: "Spending" } as any,
      ]),
    ).toEqual({
      kind: "wallet_set",
      walletIds: ["wallet-1", "wallet-2"],
    });
    expect(buildConsoleScope(ALL_WALLETS_SCOPE_ID, [])).toEqual({
      kind: "general",
    });
    expect(
      buildWalletSetScopeIds(
        Array.from(
          { length: MAX_WALLET_SET_SCOPE_WALLETS + 1 },
          (_, index) => ({
            id: `wallet-${index}`,
            name: `Wallet ${index}`,
          }),
        ) as any,
      ),
    ).toHaveLength(MAX_WALLET_SET_SCOPE_WALLETS);
    expect(getScopeLabel({ kind: "general" }, [])).toBe("General network");
    expect(
      getScopeLabel({ kind: "wallet", walletId: "wallet-1" }, [
        { id: "wallet-1", name: "Vault" } as any,
      ]),
    ).toBe("Vault");
    expect(getScopeLabel({ kind: "wallet", walletId: "missing" }, [])).toBe(
      "Wallet scope",
    );
    expect(
      getScopeLabel({ kind: "wallet_set", walletIds: ["a", "b"] }, []),
    ).toBe("2 wallets");
    expect(
      getScopeLabel({ kind: "wallet_set", walletIds: ["a", "b"] }, [
        { id: "a", name: "A" } as any,
        { id: "b", name: "B" } as any,
      ]),
    ).toBe("All visible wallets");
    expect(
      getScopeLabel(
        {
          kind: "object",
          walletId: "wallet-1",
          objectType: "transaction",
          objectId: "tx-1",
        },
        [],
      ),
    ).toBe("transaction scope");
    expect(getScopeLabel({ kind: "admin" }, [])).toBe("Admin scope");
    expect(getPromptTitle(basePrompt)).toBe("Prompt body");
    expect(getPromptTitle({ ...basePrompt, title: "Saved title" })).toBe(
      "Saved title",
    );
    expect(getErrorMessage(new Error("specific"), "fallback")).toBe("specific");
    expect(getErrorMessage("nope", "fallback")).toBe("fallback");
    expect(
      getErrorDetails(
        new ApiError("provider down", 503, {
          code: "SERVICE_UNAVAILABLE",
          details: { path: "/console/plan" },
          requestId: "req-1",
        }),
      ),
    ).toContain("HTTP status: 503");
    expect(
      isConsoleSetupError(
        new ApiError("disabled", 403, { feature: "sanctuaryConsole" }),
      ),
    ).toBe(true);
    expect(
      isConsoleSetupError(
        new ApiError(
          "AI provider is not configured for Sanctuary Console",
          503,
        ),
      ),
    ).toBe(true);
    expect(isConsoleSetupError(new ApiError("forbidden", 403))).toBe(false);
    expect(isConsoleSetupError(new ApiError("nope", 500))).toBe(false);
  });

  it("formats dates and trace summaries across edge cases", () => {
    expect(formatShortDate(null)).toBe("");
    expect(formatShortDate("not-a-date")).toBe("");
    expect(formatShortDate("2026-04-26T01:00:00.000Z")).toContain("Apr");
    expect(
      summarizeTrace({ ...baseTrace, status: "failed", errorMessage: null }),
    ).toBe("Tool failed");
    expect(
      summarizeTrace({
        ...baseTrace,
        status: "failed",
        errorMessage: "provider failed",
      }),
    ).toBe("provider failed");
    expect(summarizeTrace({ ...baseTrace, status: "denied" })).toBe(
      "Denied by scope or sensitivity",
    );
    expect(summarizeTrace({ ...baseTrace, facts: null })).toBe("Completed");
    expect(summarizeTrace({ ...baseTrace, facts: {} })).toBe("Completed");
    expect(
      summarizeTrace({
        ...baseTrace,
        facts: { missing: null, list: [1, 2], object: { a: true } },
      }),
    ).toBe("missing: none · list: 2 items");
    expect(
      summarizeTrace({
        ...baseTrace,
        facts: { object: { a: true }, fn: () => undefined },
      }),
    ).toBe("object: 1 fields · fn: value");
  });

  it("orders sessions and maps turn results into messages", () => {
    const later = {
      ...baseSession,
      id: "session-b",
      updatedAt: "2026-04-26T02:00:00.000Z",
    };

    expect(
      sortSessionsByUpdatedAt([baseSession, later]).map((entry) => entry.id),
    ).toEqual(["session-b", "session-a"]);
    expect(mergeSession([baseSession], later).map((entry) => entry.id)).toEqual(
      ["session-b", "session-a"],
    );
    expect(
      mergeSession([baseSession, later], { ...later, title: "Updated" })[0]
        ?.title,
    ).toBe("Updated");

    const messages = turnsToMessages([
      baseTurn,
      {
        ...baseTurn,
        id: "turn-b",
        state: "failed",
        response: null,
        toolTraces: undefined,
      },
      {
        ...baseTurn,
        id: "turn-c",
        state: "completed",
        response: null,
        completedAt: null,
      },
    ]);

    expect(messages.map((message) => message.content)).toContain(
      "The Console turn failed.",
    );
    expect(messages.map((message) => message.content)).toContain(
      "No response was returned.",
    );
    expect(messages[1]?.traces).toEqual([baseTrace]);
    expect(messages[1]?.details).toContain("wallet.summary");
  });

  it("appends turn results and merges prompt history records", () => {
    const appended = appendTurnResult([], {
      session: baseSession,
      turn: { ...baseTurn, response: null, completedAt: null },
      promptHistory: basePrompt,
      toolTraces: [baseTrace],
    });

    expect(appended).toHaveLength(2);
    expect(appended[1]?.content).toBe("No response was returned.");
    expect(appended[1]?.createdAt).toBe(baseTurn.createdAt);
    expect(appended[1]?.traces).toEqual([baseTrace]);
    expect(appended[1]?.details).toContain("Facts");

    const pending = appendPendingPrompt([], {
      id: "pending:1",
      prompt: "Current block?",
      createdAt: baseTurn.createdAt,
    });
    const replaced = replacePendingPromptWithTurnResult(pending, "pending:1", {
      turn: baseTurn,
      promptHistory: basePrompt,
      toolTraces: [baseTrace],
      session: baseSession,
    });
    const failed = appendFailedAssistantMessage(pending, {
      id: "pending:1:failed",
      content: "provider down",
      createdAt: baseTurn.createdAt,
      details: "HTTP status: 503",
    });

    expect(replaced.map((message) => message.id)).toEqual([
      "turn-a:prompt",
      "turn-a:response",
    ]);
    expect(failed.map((message) => message.content)).toEqual([
      "Current block?",
      "provider down",
    ]);
    expect(getTurnDetails({ ...baseTurn, model: "llama3.2" }, [])).toContain(
      "llama3.2",
    );

    expect(
      mergePromptHistory([basePrompt], {
        ...basePrompt,
        prompt: "Updated",
      }).map((entry) => entry.prompt),
    ).toEqual(["Updated"]);
    expect(
      mergePromptHistory([basePrompt], { ...basePrompt, id: "prompt-b" }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["prompt-b"]);
    expect(
      dedupePromptHistory([
        {
          ...basePrompt,
          id: "prompt-new",
          updatedAt: "2026-04-26T02:00:00.000Z",
        },
        {
          ...basePrompt,
          id: "prompt-old",
          updatedAt: "2026-04-26T01:00:00.000Z",
        },
        {
          ...basePrompt,
          id: "prompt-wallet",
          scope: { kind: "wallet", walletId: "wallet-1" },
        },
      ]).map((entry) => entry.id),
    ).toEqual(["prompt-new", "prompt-wallet"]);
  });

  it("compresses older Console messages and hides duplicate reruns", () => {
    const makeTurn = (
      id: string,
      prompt: string,
      response: string,
      createdAt: string,
    ): ConsoleTurn => ({
      ...baseTurn,
      id,
      prompt,
      response,
      createdAt,
      completedAt: createdAt,
      toolTraces: [],
    });
    const messages = turnsToMessages([
      makeTurn(
        "turn-1",
        "Current block?",
        "Block 840000.",
        "2026-04-26T01:00:00.000Z",
      ),
      makeTurn(
        "turn-2",
        "Fee estimate?",
        "Fees are 4 sat/vB.",
        "2026-04-26T01:01:00.000Z",
      ),
      makeTurn(
        "turn-3",
        "Current block?",
        "Block 840000.",
        "2026-04-26T01:02:00.000Z",
      ),
      makeTurn(
        "turn-4",
        "Wallet count?",
        "Two wallets.",
        "2026-04-26T01:03:00.000Z",
      ),
    ]);

    const displayItems = compressConsoleMessages(messages, 2);

    expect(displayItems[0]).toMatchObject({
      kind: "summary",
      hiddenMessageCount: 4,
      hiddenTurnCount: 2,
      duplicateTurnCount: 1,
    });
    expect(
      displayItems
        .filter((item) => item.kind === "message")
        .map((item) => item.message.content),
    ).toEqual([
      "Current block?",
      "Block 840000.",
      "Wallet count?",
      "Two wallets.",
    ]);
  });
});
