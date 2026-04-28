import { describe, expect, it } from "vitest";
import {
  extractConsoleTransactionFilter,
  extractConsoleTransactionQuery,
  parseTransactionDateMillis,
  parseConsoleTransactionFilterState,
  parseConsoleTransactionQueryState,
  walletIdFromWalletRoute,
} from "../../../src/app/consoleTransactionNavigation";
import type { ConsoleTurnResult } from "../../../src/api/console";

function turnResult(plannedTools: unknown): ConsoleTurnResult {
  return {
    session: {} as ConsoleTurnResult["session"],
    promptHistory: {} as ConsoleTurnResult["promptHistory"],
    toolTraces: [],
    turn: {
      id: "turn-1",
      sessionId: "session-1",
      state: "completed",
      prompt: "show transactions",
      maxSensitivity: "wallet",
      createdAt: "2026-04-27T00:00:00.000Z",
      plannedTools: plannedTools as Record<string, unknown>,
    },
  };
}

describe("console transaction navigation", () => {
  it("extracts wallet transaction filters from planned Console tool calls", () => {
    const result = turnResult({
      toolCalls: [
        {
          name: "query_transactions",
          input: {
            walletId: "wallet-1",
            dateFrom: "2020-02-01T00:00:00.000Z",
            dateTo: "2020-06-30T23:59:59.999Z",
            type: "received",
            limit: 25,
          },
        },
      ],
    });

    expect(
      extractConsoleTransactionFilter(result, new Set(["wallet-1"])),
    ).toEqual({
      walletId: "wallet-1",
      dateFrom: "2020-02-01T00:00:00.000Z",
      dateTo: "2020-06-30T23:59:59.999Z",
      type: "received",
      limit: 25,
    });
  });

  it("ignores non-transaction calls and wallets outside the visible set", () => {
    expect(
      extractConsoleTransactionFilter(
        turnResult({
          toolCalls: [
            { name: "get_wallet_overview", input: { walletId: "wallet-1" } },
          ],
        }),
        new Set(["wallet-1"]),
      ),
    ).toBeNull();

    expect(
      extractConsoleTransactionFilter(
        turnResult({
          toolCalls: [
            { name: "query_transactions", input: { walletId: "wallet-2" } },
          ],
        }),
        new Set(["wallet-1"]),
      ),
    ).toBeNull();
  });

  it("extracts a multi-wallet transaction query for aggregate results", () => {
    const result = turnResult({
      toolCalls: [
        {
          name: "query_transactions",
          input: { walletId: "wallet-1", dateFrom: "2020-02-01" },
        },
        {
          name: "query_transactions",
          input: { walletId: "wallet-2", dateFrom: "2020-02-01" },
        },
      ],
    });

    expect(
      extractConsoleTransactionFilter(
        result,
        new Set(["wallet-1", "wallet-2"]),
      ),
    ).toBeNull();
    expect(
      extractConsoleTransactionQuery(result, new Set(["wallet-1", "wallet-2"])),
    ).toEqual({
      prompt: "show transactions",
      walletFilters: [
        { walletId: "wallet-1", dateFrom: "2020-02-01" },
        { walletId: "wallet-2", dateFrom: "2020-02-01" },
      ],
    });
  });

  it("omits empty prompts from aggregate transaction query state", () => {
    const result = turnResult({
      toolCalls: [
        {
          name: "query_transactions",
          input: { walletId: "wallet-1" },
        },
      ],
    });
    result.turn.prompt = "   ";

    expect(
      extractConsoleTransactionQuery(result, new Set(["wallet-1"])),
    ).toEqual({
      walletFilters: [{ walletId: "wallet-1" }],
    });
  });

  it("dedupes repeated transaction queries from the same Console turn", () => {
    const result = turnResult({
      toolCalls: [
        { name: "query_transactions", input: { walletId: "wallet-1" } },
        { name: "query_transactions", input: { walletId: "wallet-1" } },
      ],
    });

    expect(
      extractConsoleTransactionFilter(result, new Set(["wallet-1"])),
    ).toEqual({
      walletId: "wallet-1",
    });
  });

  it("parses transaction route state into table filter values", () => {
    expect(
      parseConsoleTransactionFilterState({
        walletId: "wallet-1",
        dateFrom: "2020-02-01",
        dateTo: "2020-06-30",
        type: "sent",
      }),
    ).toEqual({
      walletId: "wallet-1",
      dateFrom: Date.UTC(2020, 1, 1, 0, 0, 0, 0),
      dateTo: Date.UTC(2020, 5, 30, 23, 59, 59, 999),
      type: "sent",
      limit: null,
    });

    expect(parseConsoleTransactionFilterState({ walletId: "" })).toBeNull();
  });

  it("parses aggregate transaction route state and filters unknown wallets", () => {
    expect(
      parseConsoleTransactionQueryState(
        {
          prompt: "show all wallets transactions",
          walletFilters: [
            { walletId: "wallet-1", limit: "15" },
            { walletId: "wallet-2", limit: 999 },
          ],
        },
        new Set(["wallet-1"]),
      ),
    ).toEqual({
      prompt: "show all wallets transactions",
      walletFilters: [
        {
          walletId: "wallet-1",
          dateFrom: null,
          dateTo: null,
          type: null,
          limit: 15,
        },
      ],
    });

    expect(
      parseConsoleTransactionQueryState(
        {
          walletFilters: [{ walletId: "wallet-2" }],
        },
        new Set(["wallet-1"]),
      ),
    ).toBeNull();
  });

  it("parses numeric and timestamp transaction dates", () => {
    expect(parseTransactionDateMillis(1_700_000_000, false)).toBe(
      1_700_000_000,
    );
    expect(parseTransactionDateMillis(Number.NaN, false)).toBeNull();
    expect(parseTransactionDateMillis("2020-02-01T12:34:56.000Z", false)).toBe(
      Date.parse("2020-02-01T12:34:56.000Z"),
    );
    expect(parseTransactionDateMillis("not-a-date", true)).toBeNull();
  });

  it("reads known wallet ids from wallet detail routes only", () => {
    const walletIds = new Set(["wallet-1"]);

    expect(walletIdFromWalletRoute("/wallets/wallet-1", walletIds)).toBe(
      "wallet-1",
    );
    expect(walletIdFromWalletRoute("/wallets/wallet-2", walletIds)).toBeNull();
    expect(walletIdFromWalletRoute("/settings", walletIds)).toBeNull();
  });
});
