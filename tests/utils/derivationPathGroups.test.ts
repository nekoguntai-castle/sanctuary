import { describe, expect, it } from "vitest";
import {
  derivationNetworkGroup,
  derivationPathCoinType,
  derivationPathMatchesNetwork,
  groupAccountsByNetwork,
  groupAccountsByPurpose,
  isTestnetSignetDerivationPath,
  networkGroupMatchesNetwork,
  splitTestnetSignetAccounts,
} from "../../src/utils/derivationPathGroups";

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

  it("groups accounts by network family and purpose", () => {
    const accounts = [
      { id: "main-single", purpose: "single_sig" as const, derivationPath: "m/84'/0'/0'" },
      { id: "test-multi", purpose: "multisig" as const, derivationPath: "m/48'/1'/0'/2'" },
    ];

    expect(derivationNetworkGroup("m/84'/1'/0'")).toBe("testnet-signet");
    expect(derivationPathMatchesNetwork("not-a-path", "signet")).toBe(false);
    expect(networkGroupMatchesNetwork("mainnet", "mainnet")).toBe(true);
    expect(networkGroupMatchesNetwork("testnet-signet", "signet")).toBe(true);
    expect(networkGroupMatchesNetwork("testnet-signet", "mainnet")).toBe(false);
    expect(groupAccountsByNetwork(accounts)).toEqual({
      mainnet: [accounts[0]],
      "testnet-signet": [accounts[1]],
    });
    expect(groupAccountsByPurpose(accounts)).toEqual({
      single_sig: [accounts[0]],
      multisig: [accounts[1]],
    });
  });

  it("classifies h-notation account paths by coin type", () => {
    expect(isTestnetSignetDerivationPath("m/84h/1h/0h")).toBe(true);
    expect(isTestnetSignetDerivationPath("m/48H/1H/0H/2H")).toBe(true);
    expect(derivationPathMatchesNetwork("m/84h/0h/0h", "mainnet")).toBe(true);
    expect(derivationNetworkGroup("m/86h/1h/0h")).toBe("testnet-signet");
    const accounts = [{ id: "h-test", derivationPath: "m/84h/1h/0h" }];
    expect(groupAccountsByNetwork(accounts)).toEqual({ mainnet: [], "testnet-signet": [accounts[0]] });
    expect(splitTestnetSignetAccounts(accounts)).toEqual({ primaryAccounts: [], testnetSignetAccounts: [accounts[0]] });
  });

  it("guard: keeps non-canonical paths unparsed", () => {
    expect(derivationPathCoinType("M/84h/0h/0h")).toBeNull();
    expect(derivationPathCoinType("not-a-path")).toBeNull();
  });
});
