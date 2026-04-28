import { describe, expect, it, vi } from "vitest";
import {
  buildConsolePlanMessages,
  parseConsolePlanResponse,
} from "../../ai-proxy/src/consoleProtocol";

const queryTransactionsTool = {
  name: "query_transactions",
  title: "Query Transactions",
  description: "Search and filter wallet transactions",
  sensitivity: "wallet",
  requiredScope: "wallet",
  inputFields: ["walletId", "dateFrom", "dateTo", "limit"],
};

const walletOverviewTool = {
  name: "get_wallet_overview",
  title: "Get Wallet Overview",
  description: "Comprehensive read-only summary for one wallet",
  sensitivity: "wallet",
  requiredScope: "wallet",
  inputFields: ["walletId"],
};

const dashboardSummaryTool = {
  name: "get_dashboard_summary",
  title: "Get Dashboard Summary",
  description: "Portfolio-style summary for accessible wallets",
  sensitivity: "wallet",
  requiredScope: "authenticated",
  inputFields: ["network", "limit"],
};

const walletPlanInput = {
  prompt:
    "Display transactions for this wallet between February 2020 and June 2020",
  scope: {
    kind: "wallet",
    walletId: "da17d9d4-c760-4929-a207-2a45c3cadef9",
  },
  maxToolCalls: 4,
  tools: [queryTransactionsTool, walletOverviewTool],
};

const autoWalletSetPlanInput = {
  ...walletPlanInput,
  scope: {
    kind: "wallet_set",
    walletIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  },
  context: {
    mode: "auto",
    currentWalletId: "22222222-2222-4222-8222-222222222222",
    currentWalletName: "Spending",
    wallets: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Main Vault",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Spending",
      },
    ],
  },
};

describe("console planner protocol", () => {
  it("recovers the final JSON plan when model output contains reasoning JSON first", () => {
    const result = parseConsolePlanResponse(
      [
        '<think>I should use an object like {"name":"query_transactions"}.</think>',
        '{"toolCalls":[{"name":"query_transactions","input":{"walletId":"da17d9d4-c760-4929-a207-2a45c3cadef9"},"reason":"read wallet transactions"}]}',
      ].join("\n"),
      4,
      walletPlanInput,
    );

    expect(result).toEqual({
      toolCalls: [
        {
          name: "query_transactions",
          input: {
            walletId: "da17d9d4-c760-4929-a207-2a45c3cadef9",
          },
          reason: "read wallet transactions",
        },
      ],
      warnings: [],
    });
  });

  it("falls back to wallet transaction planning when local model output is not JSON", () => {
    const result = parseConsolePlanResponse(
      "I should retrieve the matching transactions from the selected wallet.",
      4,
      walletPlanInput,
    );

    expect(result.toolCalls).toEqual([
      {
        name: "query_transactions",
        input: {
          walletId: "da17d9d4-c760-4929-a207-2a45c3cadef9",
          dateFrom: "2020-02-01T00:00:00.000Z",
          dateTo: "2020-06-30T23:59:59.999Z",
          limit: 100,
        },
        reason: "Fallback plan for wallet transaction request.",
      },
    ]);
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });

  it("adds current date context for relative-date intent planning", () => {
    const messages = buildConsolePlanMessages({
      ...walletPlanInput,
      currentDate: "2026-04-28",
    });

    expect(messages[0]?.content).toContain("semantic intents");
    expect(messages[1]?.content).toContain('"currentDate": "2026-04-28"');
  });

  it("resolves current-year transaction intents without phrase parsing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));

    try {
      const result = parseConsolePlanResponse(
        JSON.stringify({
          intents: [
            {
              name: "query_transactions",
              target: { kind: "current_wallet" },
              filters: {
                dateRange: { kind: "relative", value: "current_year" },
              },
              reason: "read current-year transactions",
            },
          ],
        }),
        4,
        {
          ...walletPlanInput,
          currentDate: "2026-04-28",
          prompt: "show me transactions from this year",
        },
      );

      expect(result.toolCalls).toEqual([
        {
          name: "query_transactions",
          input: {
            walletId: "da17d9d4-c760-4929-a207-2a45c3cadef9",
            dateFrom: "2026-01-01T00:00:00.000Z",
            dateTo: "2026-12-31T23:59:59.999Z",
            limit: 100,
          },
          reason: "read current-year transactions",
        },
      ]);
      expect(result.warnings).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed transaction intents without falling back to prompt regexes", () => {
    const result = parseConsolePlanResponse(
      JSON.stringify({
        intents: [
          {
            name: "query_transactions",
            target: { kind: "current_wallet" },
            filters: { dateRange: "this_year" },
          },
        ],
      }),
      4,
      walletPlanInput,
    );

    expect(result).toEqual({
      toolCalls: [],
      warnings: ["model_response_invalid_intent"],
    });
  });

  it("fails closed when a valid transaction intent target cannot be resolved", () => {
    const result = parseConsolePlanResponse(
      JSON.stringify({
        intents: [
          {
            name: "query_transactions",
            target: { kind: "current_wallet" },
            filters: {
              dateRange: { kind: "relative", value: "current_year" },
            },
          },
        ],
      }),
      4,
      {
        ...walletPlanInput,
        scope: {
          kind: "wallet_set",
          walletIds: [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
          ],
        },
      },
    );

    expect(result).toEqual({
      toolCalls: [],
      warnings: ["model_response_unresolved_intent"],
    });
  });

  it("falls back to one transaction tool call per wallet-set member", () => {
    const result = parseConsolePlanResponse(
      "I should retrieve transactions for each scoped wallet.",
      2,
      {
        ...walletPlanInput,
        scope: {
          kind: "wallet_set",
          walletIds: [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
          ],
        },
      },
    );

    expect(result.toolCalls).toEqual([
      {
        name: "query_transactions",
        input: {
          walletId: "11111111-1111-4111-8111-111111111111",
          dateFrom: "2020-02-01T00:00:00.000Z",
          dateTo: "2020-06-30T23:59:59.999Z",
          limit: 100,
        },
        reason: "Fallback plan for wallet transaction request.",
      },
      {
        name: "query_transactions",
        input: {
          walletId: "22222222-2222-4222-8222-222222222222",
          dateFrom: "2020-02-01T00:00:00.000Z",
          dateTo: "2020-06-30T23:59:59.999Z",
          limit: 100,
        },
        reason: "Fallback plan for wallet transaction request.",
      },
    ]);
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
      "tool_call_limit_applied",
    ]);
  });

  it("uses current route wallet context for ambiguous auto transaction fallback", () => {
    const result = parseConsolePlanResponse(
      "I should retrieve the matching transactions.",
      4,
      autoWalletSetPlanInput,
    );

    expect(result.toolCalls).toEqual([
      {
        name: "query_transactions",
        input: {
          walletId: "22222222-2222-4222-8222-222222222222",
          dateFrom: "2020-02-01T00:00:00.000Z",
          dateTo: "2020-06-30T23:59:59.999Z",
          limit: 100,
        },
        reason: "Fallback plan for wallet transaction request.",
      },
    ]);
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });

  it("plans one transaction call per scoped wallet for explicit all-wallet auto prompts", () => {
    const result = parseConsolePlanResponse(
      "I should retrieve matching transactions for all scoped wallets.",
      4,
      {
        ...autoWalletSetPlanInput,
        prompt: "show all wallets transactions between feb 2020 and june 2020",
      },
    );

    expect(result.toolCalls.map((call) => call.input.walletId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });

  it("plans all scoped wallets for unqualified all-transactions auto prompts", () => {
    const result = parseConsolePlanResponse(
      "I should retrieve matching transactions.",
      4,
      {
        ...autoWalletSetPlanInput,
        prompt: "show me all transactions in june 2020",
      },
    );

    expect(result.toolCalls).toEqual([
      {
        name: "query_transactions",
        input: {
          walletId: "11111111-1111-4111-8111-111111111111",
          dateFrom: "2020-06-01T00:00:00.000Z",
          dateTo: "2020-06-30T23:59:59.999Z",
          limit: 100,
        },
        reason: "Fallback plan for wallet transaction request.",
      },
      {
        name: "query_transactions",
        input: {
          walletId: "22222222-2222-4222-8222-222222222222",
          dateFrom: "2020-06-01T00:00:00.000Z",
          dateTo: "2020-06-30T23:59:59.999Z",
          limit: 100,
        },
        reason: "Fallback plan for wallet transaction request.",
      },
    ]);
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });

  it("keeps current-wallet all-transactions prompts scoped to the current wallet", () => {
    const result = parseConsolePlanResponse(
      "I should retrieve matching transactions.",
      4,
      {
        ...autoWalletSetPlanInput,
        prompt: "show me all transactions in this wallet in june 2020",
      },
    );

    expect(result.toolCalls).toEqual([
      {
        name: "query_transactions",
        input: {
          walletId: "22222222-2222-4222-8222-222222222222",
          dateFrom: "2020-06-01T00:00:00.000Z",
          dateTo: "2020-06-30T23:59:59.999Z",
          limit: 100,
        },
        reason: "Fallback plan for wallet transaction request.",
      },
    ]);
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });

  it("falls back when local model returns a placeholder tool name", () => {
    const result = parseConsolePlanResponse(
      JSON.stringify({
        toolCalls: [{ name: "tool_name", input: {}, reason: "short reason" }],
      }),
      4,
      {
        ...autoWalletSetPlanInput,
        prompt: "show all wallets transactions between feb 2020 and june 2020",
      },
    );

    expect(result.toolCalls.map((call) => call.input.walletId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(result.warnings).toEqual([
      "model_response_unknown_tool",
      "fallback_plan_applied",
    ]);
  });

  it("drops unknown model tool names while keeping valid listed calls", () => {
    const result = parseConsolePlanResponse(
      JSON.stringify({
        toolCalls: [
          { name: "tool_name", input: {}, reason: "placeholder" },
          {
            name: "query_transactions",
            input: {
              walletId: "22222222-2222-4222-8222-222222222222",
            },
            reason: "valid tool",
          },
        ],
      }),
      4,
      autoWalletSetPlanInput,
    );

    expect(result.toolCalls).toEqual([
      {
        name: "query_transactions",
        input: { walletId: "22222222-2222-4222-8222-222222222222" },
        reason: "valid tool",
      },
    ]);
    expect(result.warnings).toEqual(["model_response_unknown_tool"]);
  });

  it("uses a named accessible wallet for auto transaction fallback", () => {
    const result = parseConsolePlanResponse(
      "I should retrieve Main Vault transactions.",
      4,
      {
        ...autoWalletSetPlanInput,
        prompt: "show Main Vault transactions between feb 2020 and june 2020",
      },
    );

    expect(result.toolCalls[0]?.input.walletId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });

  it("does not guess a wallet for ambiguous auto transaction fallback", () => {
    const result = parseConsolePlanResponse(
      "I should retrieve transactions.",
      4,
      {
        ...autoWalletSetPlanInput,
        context: {
          mode: "auto",
          wallets: autoWalletSetPlanInput.context.wallets,
        },
      },
    );

    expect(result).toEqual({
      toolCalls: [],
      warnings: ["model_response_not_json"],
    });
  });

  it("does not fallback when the selected scope is not a wallet scope", () => {
    const result = parseConsolePlanResponse("I cannot produce a plan.", 4, {
      ...walletPlanInput,
      scope: { kind: "general" },
    });

    expect(result).toEqual({
      toolCalls: [],
      warnings: ["model_response_not_json"],
    });
  });

  it("falls back to wallet overview planning for broad wallet prompts", () => {
    const result = parseConsolePlanResponse("Let me inspect the wallet.", 4, {
      ...walletPlanInput,
      prompt: "How is this wallet doing?",
    });

    expect(result.toolCalls).toEqual([
      {
        name: "get_wallet_overview",
        input: {
          walletId: "da17d9d4-c760-4929-a207-2a45c3cadef9",
        },
        reason: "Fallback plan for wallet overview request.",
      },
    ]);
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });

  it("falls back to dashboard summary planning for all-wallet prompts", () => {
    const result = parseConsolePlanResponse(
      "Let me inspect the portfolio.",
      4,
      {
        ...walletPlanInput,
        prompt: "summarize all wallets",
        scope: {
          kind: "wallet_set",
          walletIds: ["11111111-1111-4111-8111-111111111111"],
        },
        tools: [
          queryTransactionsTool,
          walletOverviewTool,
          dashboardSummaryTool,
        ],
      },
    );

    expect(result.toolCalls).toEqual([
      {
        name: "get_dashboard_summary",
        input: { limit: 100 },
        reason: "Fallback plan for all-wallet dashboard summary.",
      },
    ]);
    expect(result.warnings).toEqual([
      "model_response_not_json",
      "fallback_plan_applied",
    ]);
  });
});
