import { describe, expect, it } from "vitest";
import {
  bitcoinJsNetworkName,
  coinTypeForBitcoinNetwork,
  formatBitcoinNetworkLabel,
  isBitcoinNetwork,
  isBitcoinTestnetFamily,
  normalizeLegacyBitcoinNetwork,
  resolveDetectedBitcoinNetwork,
} from "../../../../src/services/bitcoin/networks";

describe("bitcoin network helpers", () => {
  it("normalizes legacy and invalid network values at compatibility boundaries", () => {
    expect(normalizeLegacyBitcoinNetwork("testnet")).toBe("testnet3");
    expect(normalizeLegacyBitcoinNetwork("testnet4")).toBe("testnet4");
    expect(normalizeLegacyBitcoinNetwork("invalid", "signet")).toBe("signet");
    expect(normalizeLegacyBitcoinNetwork(undefined, "regtest")).toBe("regtest");

    expect(isBitcoinNetwork("testnet3")).toBe(true);
    expect(isBitcoinNetwork("testnet")).toBe(false);
    expect(isBitcoinNetwork(null)).toBe(false);
  });

  it("maps app networks to bitcoinjs network families and BIP coin types", () => {
    expect(bitcoinJsNetworkName("mainnet")).toBe("mainnet");
    expect(bitcoinJsNetworkName("regtest")).toBe("regtest");

    for (const network of ["testnet", "testnet3", "testnet4", "signet"]) {
      expect(isBitcoinTestnetFamily(network)).toBe(true);
      expect(bitcoinJsNetworkName(network)).toBe("testnet");
      expect(coinTypeForBitcoinNetwork(network)).toBe(1);
    }

    expect(isBitcoinTestnetFamily("mainnet")).toBe(false);
    expect(isBitcoinTestnetFamily(undefined)).toBe(false);
    expect(coinTypeForBitcoinNetwork("mainnet")).toBe(0);
  });

  it("resolves detected testnet-family descriptors from the requested network", () => {
    expect(resolveDetectedBitcoinNetwork("mainnet")).toBe("mainnet");
    expect(resolveDetectedBitcoinNetwork("testnet")).toBe("testnet3");
    expect(resolveDetectedBitcoinNetwork(undefined)).toBe("testnet3");
    expect(resolveDetectedBitcoinNetwork("testnet3", "testnet4")).toBe(
      "testnet4",
    );
  });

  it("formats explicit network labels for user-facing messages", () => {
    expect(formatBitcoinNetworkLabel("testnet3")).toBe("Testnet3");
    expect(formatBitcoinNetworkLabel("testnet4")).toBe("Testnet4");
    expect(formatBitcoinNetworkLabel("signet")).toBe("Signet");
    expect(formatBitcoinNetworkLabel("regtest")).toBe("Regtest");
    expect(formatBitcoinNetworkLabel("mainnet")).toBe("Mainnet");
  });
});
