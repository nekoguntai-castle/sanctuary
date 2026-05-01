import { describe, expect, it } from "vitest";
import {
  isTestnetSignetDerivationPath,
  splitTestnetSignetAccounts,
} from "../../utils/derivationPathGroups";

describe("derivationPathGroups", () => {
  it("detects coin-type 1 paths as testnet/signet paths", () => {
    expect(isTestnetSignetDerivationPath("m/84'/1'/0'")).toBe(true);
    expect(isTestnetSignetDerivationPath("m/86'/1'/0'")).toBe(true);
    expect(isTestnetSignetDerivationPath("m/48'/1'/0'/2'")).toBe(true);
  });

  it("keeps mainnet and malformed paths in the primary group", () => {
    expect(isTestnetSignetDerivationPath("m/84'/0'/0'")).toBe(false);
    expect(isTestnetSignetDerivationPath("not-a-path")).toBe(false);

    const accounts = [
      { id: "mainnet", derivationPath: "m/84'/0'/0'" },
      { id: "testnet", derivationPath: "m/84'/1'/0'" },
      { id: "malformed", derivationPath: "not-a-path" },
      { id: "signet", derivationPath: "m/86'/1'/0'" },
    ];

    expect(splitTestnetSignetAccounts(accounts)).toEqual({
      primaryAccounts: [accounts[0], accounts[2]],
      testnetSignetAccounts: [accounts[1], accounts[3]],
    });
  });
});
