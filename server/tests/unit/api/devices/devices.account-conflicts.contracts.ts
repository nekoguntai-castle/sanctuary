import { describe, expect, it } from "vitest";
import type { DeviceAccountInput } from "../../../../src/api/devices/accountConflicts";

export function registerNormalizeIncomingAccountsTests(): void {
  describe("normalizeIncomingAccounts", () => {
    it("returns error when neither xpub nor accounts are provided", async () => {
      const { normalizeIncomingAccounts } =
        await import("../../../../src/api/devices/accountConflicts");
      const result = normalizeIncomingAccounts(undefined, undefined, undefined);
      expect(result).toEqual({
        error: "Either xpub or accounts array is required",
      });
    });

    it("returns valid multi-account input unchanged", async () => {
      const { normalizeIncomingAccounts } =
        await import("../../../../src/api/devices/accountConflicts");
      const accounts = [
        {
          purpose: "single_sig" as const,
          scriptType: "native_segwit" as const,
          derivationPath: "m/84'/0'/0'",
          xpub: "xpub-native",
        },
        {
          purpose: "multisig" as const,
          scriptType: "nested_segwit" as const,
          derivationPath: "m/48'/0'/0'/1'",
          xpub: "xpub-multisig",
        },
      ];

      expect(normalizeIncomingAccounts(accounts, undefined, undefined)).toEqual(
        { accounts },
      );
    });

    it.each([
      [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/0'",
        },
        "Each account must have purpose, scriptType, derivationPath, and xpub",
      ],
      [
        {
          purpose: "shared",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/0'",
          xpub: "xpub-native",
        },
        'Account purpose must be "single_sig" or "multisig"',
      ],
      [
        {
          purpose: "single_sig",
          scriptType: "wrapped",
          derivationPath: "m/84'/0'/0'",
          xpub: "xpub-native",
        },
        "Account scriptType must be one of: native_segwit, nested_segwit, taproot, legacy",
      ],
    ])(
      "returns validation error for invalid account %#",
      async (account, error) => {
        const { normalizeIncomingAccounts } =
          await import("../../../../src/api/devices/accountConflicts");

        expect(
          normalizeIncomingAccounts(
            [account as DeviceAccountInput],
            undefined,
            undefined,
          ),
        ).toEqual({ error });
      },
    );

    it.each([
      ["m/86'/0'/0'", "single_sig", "taproot"],
      ["m/49'/0'/0'", "single_sig", "nested_segwit"],
      ["m/44'/0'/0'", "single_sig", "legacy"],
      ["m/48'/0'/0'/2'", "multisig", "native_segwit"],
      ["m/48'/0'/0'/1'", "multisig", "nested_segwit"],
      ["m/84'/0'/0'", "single_sig", "native_segwit"],
      ["m/49h/0h/0h", "single_sig", "nested_segwit"],
    ])(
      "builds a legacy account for %s",
      async (derivationPath, purpose, scriptType) => {
        const { normalizeIncomingAccounts } =
          await import("../../../../src/api/devices/accountConflicts");

        expect(
          normalizeIncomingAccounts(undefined, "xpub-legacy", derivationPath),
        ).toEqual({
          accounts: [
            { purpose, scriptType, derivationPath, xpub: "xpub-legacy" },
          ],
        });
      },
    );

    it("rejects legacy single-account input with an unknown derivation purpose", async () => {
      const { normalizeIncomingAccounts } =
        await import("../../../../src/api/devices/accountConflicts");

      expect(
        normalizeIncomingAccounts(undefined, "xpub-legacy", "m/99'/0'/0'"),
      ).toEqual({
        error:
          "Legacy account derivationPath has unknown purpose; use accounts[] with explicit purpose and scriptType",
      });
    });

    it("rejects legacy single-account input with malformed derivation components", async () => {
      const { normalizeIncomingAccounts } =
        await import("../../../../src/api/devices/accountConflicts");

      expect(
        normalizeIncomingAccounts(undefined, "xpub-legacy", "m/84'/bad/0'"),
      ).toEqual({
        error:
          "Legacy account derivationPath is invalid; use accounts[] with explicit purpose and scriptType",
      });
    });

    it("rejects legacy single-account input with an incomplete account path", async () => {
      const { normalizeIncomingAccounts } =
        await import("../../../../src/api/devices/accountConflicts");

      expect(
        normalizeIncomingAccounts(undefined, "xpub-legacy", "m/84'"),
      ).toEqual({
        error:
          "Legacy account derivationPath is invalid; use accounts[] with explicit purpose and scriptType",
      });
    });

    it("returns empty accounts for xpub-only legacy input", async () => {
      const { normalizeIncomingAccounts } =
        await import("../../../../src/api/devices/accountConflicts");

      expect(
        normalizeIncomingAccounts(undefined, "xpub-only", undefined),
      ).toEqual({ accounts: [] });
    });
  });
}
