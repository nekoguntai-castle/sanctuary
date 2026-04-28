import { describe, expect, it } from "vitest";
import {
  extractAccountPath,
  inferScriptTypeFromPath,
  isTestnetPath,
} from "../../../services/hardwareWallet/pathUtils";

describe("isTestnetPath", () => {
  it("returns true for testnet path with coin type 1", () => {
    expect(isTestnetPath("m/84'/1'/0'")).toBe(true);
  });

  it("returns false for mainnet path with coin type 0", () => {
    expect(isTestnetPath("m/84'/0'/0'")).toBe(false);
  });

  it("returns false for mainnet account index 1 (false positive case)", () => {
    expect(isTestnetPath("m/84'/0'/1'")).toBe(false);
  });

  it("returns true for testnet path with h notation", () => {
    expect(isTestnetPath("m/84h/1h/0h")).toBe(true);
  });

  it("returns true for testnet path without m/ prefix", () => {
    expect(isTestnetPath("84'/1'/0'")).toBe(true);
  });

  it("returns false for path with too few components", () => {
    expect(isTestnetPath("m/84'")).toBe(false);
  });

  it("returns false for mainnet BIP-49 path", () => {
    expect(isTestnetPath("m/49'/0'/0'")).toBe(false);
  });

  it("returns true for testnet BIP-44 path", () => {
    expect(isTestnetPath("m/44'/1'/0'")).toBe(true);
  });

  it("returns true for testnet BIP-86 taproot path", () => {
    expect(isTestnetPath("m/86'/1'/0'")).toBe(true);
  });

  it("returns false for malformed coin type components", () => {
    expect(isTestnetPath("m/84'/bad/0'")).toBe(false);
  });
});

describe("inferScriptTypeFromPath", () => {
  it("returns p2wpkh for BIP-84 path", () => {
    expect(inferScriptTypeFromPath("m/84'/0'/0'")).toBe("p2wpkh");
  });

  it("returns p2sh-p2wpkh for BIP-49 path", () => {
    expect(inferScriptTypeFromPath("m/49'/0'/0'")).toBe("p2sh-p2wpkh");
  });

  it("returns p2pkh for BIP-44 path", () => {
    expect(inferScriptTypeFromPath("m/44'/0'/0'")).toBe("p2pkh");
  });

  it("returns p2tr for BIP-86 path", () => {
    expect(inferScriptTypeFromPath("m/86'/0'/0'")).toBe("p2tr");
  });

  it("returns p2wpkh as default for unknown purpose", () => {
    expect(inferScriptTypeFromPath("m/99'/0'/0'")).toBe("p2wpkh");
  });

  it("normalizes h notation before inferring", () => {
    expect(inferScriptTypeFromPath("49h/0h/0h")).toBe("p2sh-p2wpkh");
  });

  it("infers BIP-48 nested and native segwit script paths", () => {
    expect(inferScriptTypeFromPath("m/48'/0'/0'/1'")).toBe("p2sh-p2wpkh");
    expect(inferScriptTypeFromPath("m/48'/0'/0'/2'")).toBe("p2wpkh");
  });
});

describe("extractAccountPath", () => {
  it("extracts first 4 components from full path", () => {
    expect(extractAccountPath("m/84'/0'/0'/0/0")).toBe("m/84'/0'/0'");
  });

  it("returns normalized path when fewer than 4 components", () => {
    expect(extractAccountPath("m/84'/0'")).toBe("m/84'/0'");
  });

  it("normalizes h notation", () => {
    expect(extractAccountPath("84h/0h/0h/0/0")).toBe("m/84'/0'/0'");
  });

  it("handles exactly 4 components", () => {
    expect(extractAccountPath("m/84'/0'/0'")).toBe("m/84'/0'/0'");
  });

  it("keeps BIP-48 script path in the account path", () => {
    expect(extractAccountPath("m/48'/0'/0'/2'/0/7")).toBe("m/48'/0'/0'/2'");
  });
});
