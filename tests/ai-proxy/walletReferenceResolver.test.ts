import { describe, expect, it } from "vitest";
import { resolveWalletReferenceFromPrompt } from "../../ai-proxy/src/walletReferenceResolver";

const wallets = [
  { id: "wallet-main", name: "Main Vault" },
  { id: "wallet-spend", name: "Spending" },
  { id: "wallet-art", name: "Art" },
  { id: "wallet-short", name: "A" },
];

function resolve(
  prompt: string,
  scopedWalletIds = wallets.map((wallet) => wallet.id),
) {
  return resolveWalletReferenceFromPrompt({
    prompt,
    wallets,
    scopedWalletIds,
  });
}

describe("wallet reference resolver", () => {
  it("matches wallet names on token boundaries", () => {
    expect(resolve("show main vault transactions")).toEqual({
      ok: true,
      walletId: "wallet-main",
    });
  });

  it("does not match wallet names as substrings inside other words", () => {
    expect(resolve("show party transactions")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("fails closed when more than one scoped wallet name matches", () => {
    const result = resolveWalletReferenceFromPrompt({
      prompt: "show main vault transactions",
      wallets: [
        { id: "wallet-main", name: "Main" },
        { id: "wallet-vault", name: "Main Vault" },
      ],
      scopedWalletIds: ["wallet-main", "wallet-vault"],
    });

    expect(result).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("deduplicates repeated context rows for the same wallet id", () => {
    const result = resolveWalletReferenceFromPrompt({
      prompt: "show spending transactions",
      wallets: [
        { id: "wallet-spend", name: "Spending" },
        { id: "wallet-spend", name: "Spending" },
      ],
      scopedWalletIds: ["wallet-spend"],
    });

    expect(result).toEqual({ ok: true, walletId: "wallet-spend" });
  });

  it("rejects very short unquoted wallet names", () => {
    expect(resolve("show A transactions")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("allows very short wallet names as exact quoted references", () => {
    expect(resolve('show "A" transactions')).toEqual({
      ok: true,
      walletId: "wallet-short",
    });
  });

  it("ignores matching wallet names outside the selected scope", () => {
    expect(resolve("show spending transactions", ["wallet-main"])).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
