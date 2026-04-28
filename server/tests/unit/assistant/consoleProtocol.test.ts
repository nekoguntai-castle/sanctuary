import { describe, expect, it } from "vitest";
import {
  ConsolePromptListQuerySchema,
  ConsoleCreateSessionBodySchema,
  ConsolePromptReplayBodySchema,
  ConsoleRunTurnBodySchema,
  compactToolEnvelope,
  describeToolForPlanning,
  normalizePrompt,
  parseOptionalDate,
  parseStoredConsoleScope,
  parseStoredConsoleSensitivity,
  scopeIncludesWallet,
  scopeWalletIds,
  sensitivityAllowed,
} from "../../../src/assistant/console/protocol";

const walletId = "11111111-1111-4111-8111-111111111111";
const secondWalletId = "22222222-2222-4222-8222-222222222222";

describe("console protocol helpers", () => {
  it("normalizes prompts and optional dates", () => {
    expect(normalizePrompt("  How   Long AGO?  ")).toBe("how long ago?");
    expect(parseOptionalDate(null)).toBeNull();
    expect(parseOptionalDate(undefined)).toBeUndefined();
    expect(parseOptionalDate("2026-04-26T00:00:00.000Z")).toEqual(
      new Date("2026-04-26T00:00:00.000Z"),
    );
  });

  it('parses prompt history booleans without treating "false" as truthy', () => {
    expect(
      ConsolePromptListQuerySchema.parse({
        saved: "false",
        includeExpired: "0",
      }),
    ).toMatchObject({
      saved: false,
      includeExpired: false,
    });
    expect(
      ConsolePromptListQuerySchema.parse({
        saved: "1",
        includeExpired: "true",
      }),
    ).toMatchObject({
      saved: true,
      includeExpired: true,
    });
    expect(
      ConsolePromptListQuerySchema.parse({
        saved: ["true"],
        includeExpired: false,
      }),
    ).toMatchObject({
      saved: true,
      includeExpired: false,
    });
    expect(
      ConsolePromptListQuerySchema.parse({
        saved: "",
        limit: "500",
        offset: "-10",
      }),
    ).toMatchObject({
      limit: 100,
      offset: 0,
      includeExpired: false,
    });
    expect(
      ConsolePromptListQuerySchema.safeParse({ saved: ["true", "false"] })
        .success,
    ).toBe(false);
    expect(ConsolePromptListQuerySchema.safeParse({ saved: 1 }).success).toBe(
      false,
    );
    expect(
      ConsolePromptListQuerySchema.safeParse({ includeExpired: "definitely" })
        .success,
    ).toBe(false);
  });

  it("parses console request bodies with defaults and validation", () => {
    expect(ConsoleCreateSessionBodySchema.parse(undefined)).toEqual({
      maxSensitivity: "wallet",
    });
    expect(
      ConsoleCreateSessionBodySchema.parse({
        title: " Wallet Q&A ",
        scope: { kind: "wallet", walletId },
        maxSensitivity: "high",
        expiresAt: "2026-04-27T00:00:00.000Z",
      }),
    ).toEqual({
      title: "Wallet Q&A",
      scope: { kind: "wallet", walletId },
      maxSensitivity: "high",
      expiresAt: "2026-04-27T00:00:00.000Z",
    });
    expect(
      ConsoleRunTurnBodySchema.parse({
        prompt: " block height? ",
        clientContext: { mode: "auto", routeWalletId: walletId },
        toolCalls: [
          { name: " get_fee_estimates ", input: {}, reason: " fees " },
        ],
      }),
    ).toMatchObject({
      prompt: "block height?",
      clientContext: { mode: "auto", routeWalletId: walletId },
      maxSensitivity: "wallet",
      toolCalls: [{ name: "get_fee_estimates", input: {}, reason: "fees" }],
    });
    expect(
      ConsolePromptReplayBodySchema.parse({
        clientContext: { mode: "auto" },
      }),
    ).toEqual({
      clientContext: { mode: "auto" },
    });
    expect(ConsolePromptReplayBodySchema.parse(undefined)).toEqual({});
    expect(
      ConsoleRunTurnBodySchema.safeParse({
        prompt: "bad auto",
        clientContext: { mode: "manual" },
      }).success,
    ).toBe(false);
  });

  it("extracts and checks wallet scopes", () => {
    expect(scopeWalletIds({ kind: "general" })).toEqual([]);
    expect(scopeWalletIds({ kind: "wallet", walletId })).toEqual([walletId]);
    expect(
      scopeWalletIds({
        kind: "wallet_set",
        walletIds: [walletId, secondWalletId],
      }),
    ).toEqual([walletId, secondWalletId]);
    expect(
      scopeWalletIds({
        kind: "object",
        walletId,
        objectType: "transaction",
        objectId: "txid",
      }),
    ).toEqual([walletId]);

    expect(scopeIncludesWallet({ kind: "wallet", walletId }, walletId)).toBe(
      true,
    );
    expect(
      scopeIncludesWallet(
        { kind: "wallet_set", walletIds: [walletId] },
        secondWalletId,
      ),
    ).toBe(false);
    expect(
      scopeIncludesWallet(
        {
          kind: "object",
          walletId,
          objectType: "address",
          objectId: "bc1q",
        },
        walletId,
      ),
    ).toBe(true);
    expect(scopeIncludesWallet({ kind: "admin" }, walletId)).toBe(false);
  });

  it("bounds sensitivity and parses stored enum-like values", () => {
    expect(sensitivityAllowed("public", "public")).toBe(true);
    expect(sensitivityAllowed("wallet", "public")).toBe(false);
    expect(sensitivityAllowed("high", "admin")).toBe(true);
    expect(sensitivityAllowed("admin", "high")).toBe(false);
    expect(parseStoredConsoleSensitivity("admin")).toBe("admin");
    expect(parseStoredConsoleSensitivity("invalid")).toBe("wallet");
  });

  it("validates stored scopes and falls back to general on malformed JSON", () => {
    expect(parseStoredConsoleScope({ kind: "wallet", walletId })).toEqual({
      kind: "wallet",
      walletId,
    });
    expect(
      parseStoredConsoleScope({ kind: "wallet_set", walletIds: [] }),
    ).toEqual({ kind: "general" });
    expect(parseStoredConsoleScope(null)).toEqual({ kind: "general" });
  });

  it("describes planning tools and compacts tool envelopes", () => {
    expect(
      describeToolForPlanning({
        name: "get_fee_estimates",
        title: "Fee estimates",
        description: "Read fee estimates",
        sensitivity: "public",
        requiredScope: { kind: "authenticated", description: "authenticated" },
        inputSchema: { limit: {} },
        budgets: { maxRows: 1, maxBytes: 1024 },
        execute: async () => {
          throw new Error("not used");
        },
      } as any),
    ).toEqual({
      name: "get_fee_estimates",
      title: "Fee estimates",
      description: "Read fee estimates",
      sensitivity: "public",
      requiredScope: "authenticated",
      inputFields: ["limit"],
    });

    expect(
      compactToolEnvelope({
        data: { raw: "excluded" },
        facts: { summary: "included", items: [] },
        provenance: {
          sources: [{ type: "computed", label: "test" }],
          computedAt: "2026-04-26T00:00:00.000Z",
        },
        sensitivity: "public",
        redactions: [],
        truncation: { truncated: false },
        warnings: [],
        audit: {
          operation: "get_fee_estimates",
          source: "console",
          sensitivity: "public",
          scope: "authenticated",
          durationMs: 1,
        },
      }),
    ).toEqual({
      facts: { summary: "included", items: [] },
      provenance: {
        sources: [{ type: "computed", label: "test" }],
        computedAt: "2026-04-26T00:00:00.000Z",
      },
      sensitivity: "public",
      redactions: [],
      truncation: { truncated: false },
      warnings: [],
      audit: {
        operation: "get_fee_estimates",
        source: "console",
        sensitivity: "public",
        scope: "authenticated",
        durationMs: 1,
      },
    });
  });
});
