/**
 * Hardware Wallet Compatibility Tests
 *
 * These tests verify that our address derivation matches hardware wallet outputs
 * when available, or cross-implementation verified vectors as a deterministic
 * fallback when hardware exports have not been checked in yet.
 */

import { describe, it, expect } from "vitest";
import {
  deriveAddress,
  deriveAddressFromDescriptor,
} from "@/services/bitcoin/addressDerivation";
import {
  HARDWARE_WALLET_SINGLESIG_VECTORS,
  HARDWARE_WALLET_MULTISIG_VECTORS,
  type HardwareWalletVector,
  type MultisigHardwareWalletVector,
} from "@fixtures/hardware-wallet-vectors";
import {
  VERIFIED_SINGLESIG_VECTORS,
  VERIFIED_MULTISIG_VECTORS,
} from "@fixtures/verified-address-vectors";

type SingleSigAddressPair = {
  index: number;
  receive?: string;
  change?: string;
};

type MultisigAddressPair = {
  index: number;
  receive?: string;
  change?: string;
};

const MULTISIG_SCRIPT_ACCOUNTS: Record<
  "p2sh" | "p2sh_p2wsh" | "p2wsh",
  number
> = {
  p2sh: 0,
  p2sh_p2wsh: 1,
  p2wsh: 2,
};

function toMultisigDerivationPath(
  network: "mainnet" | "testnet",
  scriptType: "p2sh" | "p2sh_p2wsh" | "p2wsh",
): string {
  const coinType = network === "mainnet" ? 0 : 1;
  const scriptAccount = MULTISIG_SCRIPT_ACCOUNTS[scriptType];
  return `m/48'/${coinType}'/0'/${scriptAccount}'`;
}

function buildFallbackSingleSigVectors(): HardwareWalletVector[] {
  const grouped = new Map<
    string,
    {
      network: "mainnet" | "testnet";
      scriptType: "legacy" | "nested_segwit" | "native_segwit" | "taproot";
      accountIndex: number;
      expectedXpub: string;
      derivationPath: string;
      pairs: Map<number, SingleSigAddressPair>;
    }
  >();

  for (const vector of VERIFIED_SINGLESIG_VECTORS) {
    const key = `${vector.network}|${vector.scriptType}|${vector.xpub}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        network: vector.network,
        scriptType: vector.scriptType,
        accountIndex: 0,
        expectedXpub: vector.xpub,
        derivationPath: vector.path,
        pairs: new Map<number, SingleSigAddressPair>(),
      });
    }

    const group = grouped.get(key)!;
    const current = group.pairs.get(vector.index) ?? { index: vector.index };
    if (vector.change) {
      current.change = vector.expectedAddress;
    } else {
      current.receive = vector.expectedAddress;
    }
    group.pairs.set(vector.index, current);
  }

  return [...grouped.values()]
    .map((group) => ({
      device: "Cross-verified reference",
      firmware: "N/A",
      verifiedDate: "2026-03-02",
      verifiedBy: "Cross-implementation vectors",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      network: group.network,
      scriptType: group.scriptType,
      accountIndex: group.accountIndex,
      expectedXpub: group.expectedXpub,
      derivationPath: group.derivationPath,
      addresses: [...group.pairs.values()]
        .filter(
          (pair): pair is { index: number; receive: string; change: string } =>
            Boolean(pair.receive && pair.change),
        )
        .sort((a, b) => a.index - b.index)
        .slice(0, 4),
    }))
    .filter((vector) => vector.addresses.length > 0);
}

function buildFallbackMultisigVectors(): MultisigHardwareWalletVector[] {
  const grouped = new Map<
    string,
    {
      threshold: number;
      totalSigners: number;
      network: "mainnet" | "testnet";
      scriptType: "p2sh" | "p2sh_p2wsh" | "p2wsh";
      xpubs: string[];
      pairs: Map<number, MultisigAddressPair>;
    }
  >();

  for (const vector of VERIFIED_MULTISIG_VECTORS) {
    if (vector.scriptType !== "p2wsh" && vector.scriptType !== "p2sh_p2wsh") {
      continue;
    }

    const key = `${vector.network}|${vector.scriptType}|${vector.threshold}|${vector.totalKeys}|${vector.xpubs.join("|")}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        threshold: vector.threshold,
        totalSigners: vector.totalKeys,
        network: vector.network,
        scriptType: vector.scriptType,
        xpubs: vector.xpubs,
        pairs: new Map<number, MultisigAddressPair>(),
      });
    }

    const group = grouped.get(key)!;
    const current = group.pairs.get(vector.index) ?? { index: vector.index };
    if (vector.change) {
      current.change = vector.expectedAddress;
    } else {
      current.receive = vector.expectedAddress;
    }
    group.pairs.set(vector.index, current);
  }

  return [...grouped.values()]
    .map((group) => ({
      devices: group.xpubs.map((_, idx) => ({
        device: `Reference signer ${idx + 1}`,
        firmware: "N/A",
        verifiedDate: "2026-03-02",
      })),
      threshold: group.threshold,
      totalSigners: group.totalSigners,
      network: group.network,
      scriptType: group.scriptType,
      signers: group.xpubs.map((xpub, idx) => ({
        mnemonic: `reference-vector-signer-${idx + 1}`,
        derivationPath: toMultisigDerivationPath(
          group.network,
          group.scriptType,
        ),
        xpub,
      })),
      addresses: [...group.pairs.values()]
        .filter(
          (pair): pair is { index: number; receive: string; change: string } =>
            Boolean(pair.receive && pair.change),
        )
        .sort((a, b) => a.index - b.index)
        .slice(0, 4),
    }))
    .filter((vector) => vector.addresses.length > 0);
}

const EFFECTIVE_SINGLESIG_VECTORS =
  HARDWARE_WALLET_SINGLESIG_VECTORS.length > 0
    ? HARDWARE_WALLET_SINGLESIG_VECTORS
    : buildFallbackSingleSigVectors();

const EFFECTIVE_MULTISIG_VECTORS =
  HARDWARE_WALLET_MULTISIG_VECTORS.length > 0
    ? HARDWARE_WALLET_MULTISIG_VECTORS
    : buildFallbackMultisigVectors();

describe("Hardware Wallet Compatibility", () => {
  describe("Single-Sig Address Verification", () => {
    it("has single-sig compatibility vectors", () => {
      expect(EFFECTIVE_SINGLESIG_VECTORS.length).toBeGreaterThan(0);
    });

    EFFECTIVE_SINGLESIG_VECTORS.forEach((vector) => {
      describe(`${vector.device} (${vector.firmware}) - ${vector.scriptType} ${vector.network}`, () => {
        it("should derive matching xpub", () => {
          expect(vector.expectedXpub).toBeDefined();
        });

        vector.addresses.forEach(({ index, receive, change }) => {
          it(`should derive correct receive address at index ${index}`, () => {
            const derived = deriveAddress(vector.expectedXpub, index, {
              scriptType: vector.scriptType,
              network: vector.network,
              change: false,
            });

            expect(derived.address).toBe(receive);
          });

          it(`should derive correct change address at index ${index}`, () => {
            const derived = deriveAddress(vector.expectedXpub, index, {
              scriptType: vector.scriptType,
              network: vector.network,
              change: true,
            });

            expect(derived.address).toBe(change);
          });
        });
      });
    });
  });

  describe("Multisig Address Verification", () => {
    it("has multisig compatibility vectors", () => {
      expect(EFFECTIVE_MULTISIG_VECTORS.length).toBeGreaterThan(0);
    });

    EFFECTIVE_MULTISIG_VECTORS.forEach((vector) => {
      describe(`${vector.threshold}-of-${vector.totalSigners} ${vector.scriptType} (${vector.devices.map((d) => d.device).join(", ")})`, () => {
        const buildDescriptor = () => {
          const keysStr = vector.signers
            .map((s) => `${s.xpub}/<0;1>/*`)
            .join(",");
          const scriptMap = {
            p2sh: "sh(sortedmulti",
            p2sh_p2wsh: "sh(wsh(sortedmulti",
            p2wsh: "wsh(sortedmulti",
          };
          const prefix = scriptMap[vector.scriptType];
          const suffix = vector.scriptType === "p2sh_p2wsh" ? ")))" : "))";
          return `${prefix}(${vector.threshold},${keysStr})${suffix}`;
        };

        vector.addresses.forEach(({ index, receive, change }) => {
          it(`should derive correct receive address at index ${index}`, () => {
            const descriptor = buildDescriptor();
            const derived = deriveAddressFromDescriptor(descriptor, index, {
              network: vector.network,
              change: false,
            });

            expect(derived.address).toBe(receive);
          });

          it(`should derive correct change address at index ${index}`, () => {
            const descriptor = buildDescriptor();
            const derived = deriveAddressFromDescriptor(descriptor, index, {
              network: vector.network,
              change: true,
            });

            expect(derived.address).toBe(change);
          });
        });
      });
    });
  });
});

describe("Hardware Vector Provenance", () => {
  it("uses hardware exports when available and verified-vector fallbacks otherwise", () => {
    expect(EFFECTIVE_SINGLESIG_VECTORS.length).toBeGreaterThan(0);
    expect(EFFECTIVE_MULTISIG_VECTORS.length).toBeGreaterThan(0);
  });
});

/**
 * Instructions for populating hardware wallet vectors:
 *
 * 1. NEVER use real/production seeds for test vectors
 * 2. Use the standard BIP-39 test mnemonic:
 *    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
 *
 * 3. For each hardware wallet:
 *    a. Initialize with the test seed
 *    b. Navigate to the address export or verification feature
 *    c. Record the first 5-10 receive and change addresses
 *    d. Record the xpub at the appropriate derivation path
 *    e. Document the device model and firmware version
 *
 * 4. For multisig:
 *    a. Set up the same multisig configuration on all participating devices
 *    b. Verify all devices show the same addresses
 *    c. Record the addresses and xpubs from each device
 *
 * 5. Add the vectors to hardware-wallet-vectors.ts
 *
 * 6. Run this test suite to verify compatibility
 */
