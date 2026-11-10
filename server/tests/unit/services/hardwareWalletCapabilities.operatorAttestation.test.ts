import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HARDWARE_WALLET_CAPABILITIES,
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  OPERATOR_ATTESTED_EVIDENCE_LABEL,
} from "@sanctuary/shared/constants/hardwareWalletCapabilities";
import { ForbiddenError } from "../../../src/errors";

const mocks = vi.hoisted(() => ({
  config: {} as { hardwareWallet?: { operatorAttestedVendors: readonly string[] } },
  warn: vi.fn(),
}));

vi.mock("../../../src/config", () => ({
  getConfig: () => mocks.config,
}));

vi.mock("../../../src/repositories", () => ({
  walletRepository: { findByIdWithDevices: vi.fn() },
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
}));

import {
  assertHardwareWalletCapability,
  assertWalletHardwareCapability,
  getHardwareWalletCapabilityDecision,
  getOperatorAttestationForClient,
  getOperatorAttestedHardwareWalletVendors,
} from "../../../src/services/hardwareWalletCapabilities";

const TREZOR_MODEL_T = { type: "trezor", model: "Trezor Model T" } as const;

function attest(vendors: readonly string[]) {
  mocks.config = { hardwareWallet: { operatorAttestedVendors: vendors } };
}

describe("hardware wallet operator attestation decisions", () => {
  beforeEach(() => {
    mocks.warn.mockClear();
    attest([]);
  });

  it.each(HARDWARE_WALLET_CAPABILITIES)(
    "allows attested Trezor Model T %s and logs it without PII",
    (capability) => {
      attest(["trezor"]);

      const decision = getHardwareWalletCapabilityDecision(TREZOR_MODEL_T, capability);

      expect(decision).toEqual({
        allowed: true,
        vendor: "trezor",
        capability,
        evidenceTier: "operator-attested",
        manifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
      });
      expect(() => assertHardwareWalletCapability(TREZOR_MODEL_T, capability)).not.toThrow();
      expect(mocks.warn).toHaveBeenCalledWith(
        expect.stringContaining("not Tier 3 verified"),
        { vendor: "trezor", modelFamily: "trezor-model-t", capability },
      );
    },
  );

  it("logs each attested vendor/model/capability once, not on every decision", () => {
    attest(["trezor"]);
    const safeTrezor = { type: "trezor", model: "Trezor Safe 3" };

    for (let call = 0; call < 3; call += 1) {
      expect(getHardwareWalletCapabilityDecision(safeTrezor, "display").allowed).toBe(true);
    }

    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it("covers finalize and broadcast, which the server also gates", () => {
    attest(["trezor"]);

    expect(getHardwareWalletCapabilityDecision(TREZOR_MODEL_T, "finalize").allowed).toBe(true);
    expect(getHardwareWalletCapabilityDecision(TREZOR_MODEL_T, "broadcast").allowed).toBe(true);
  });

  it("matches the off decision exactly when attestation is not configured", () => {
    const off = getHardwareWalletCapabilityDecision(TREZOR_MODEL_T, "sign");
    mocks.config = {};
    const missingSection = getHardwareWalletCapabilityDecision(TREZOR_MODEL_T, "sign");

    expect(off).toMatchObject({ allowed: false, vendor: "trezor", evidenceTier: "unverified", evidenceIds: [] });
    expect(missingSection).toEqual(off);
    expect(getOperatorAttestedHardwareWalletVendors()).toEqual([]);
    expect(() => assertHardwareWalletCapability(TREZOR_MODEL_T, "sign")).toThrow(ForbiddenError);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("keeps other vendors blocked even if a list names them", () => {
    attest(["trezor", "ledger"]);

    const decision = getHardwareWalletCapabilityDecision({ type: "ledger", model: "Ledger Nano X" }, "sign");

    expect(decision).toMatchObject({ allowed: false, vendor: "ledger", evidenceTier: "unverified" });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("keeps an unresolved Trezor model blocked", () => {
    attest(["trezor"]);

    for (const identity of [{ type: "trezor" }, { type: "trezor", model: "Trezor Model Z" }]) {
      expect(getHardwareWalletCapabilityDecision(identity, "sign")).toMatchObject({
        allowed: false,
        vendor: "trezor",
      });
    }
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("keeps unidentified signers blocked", () => {
    attest(["trezor"]);

    expect(getHardwareWalletCapabilityDecision({ type: "hardware" }, "sign")).toMatchObject({
      allowed: false,
      vendor: "unidentified",
    });
  });

  it("blocks a mixed Trezor and Ledger wallet", () => {
    attest(["trezor"]);
    const wallet = {
      devices: [
        { device: TREZOR_MODEL_T },
        { device: { type: "ledger", model: "Ledger Nano X" } },
      ],
    };

    expect(() => assertWalletHardwareCapability(wallet, "sign")).toThrow(ForbiddenError);
    expect(() => assertWalletHardwareCapability({ devices: [{ device: TREZOR_MODEL_T }] }, "sign"))
      .not.toThrow();
  });

  it("exposes the attestation state for the client", () => {
    expect(getOperatorAttestationForClient()).toEqual({
      vendors: [],
      label: OPERATOR_ATTESTED_EVIDENCE_LABEL,
    });

    attest(["trezor"]);
    const state = getOperatorAttestationForClient();
    expect(state).toEqual({ vendors: ["trezor"], label: OPERATOR_ATTESTED_EVIDENCE_LABEL });
    expect(state.vendors).not.toBe(mocks.config.hardwareWallet?.operatorAttestedVendors);
  });
});
