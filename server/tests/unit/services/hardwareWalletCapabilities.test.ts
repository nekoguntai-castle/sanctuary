import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../../src/errors";

const mockWalletRepository = vi.hoisted(() => ({
  findByIdWithDevices: vi.fn(),
}));

vi.mock("../../../src/repositories", () => ({
  walletRepository: mockWalletRepository,
}));

import {
  assertHardwareWalletCapability,
  assertWalletHardwareCapability,
  assertWalletHardwareCapabilityById,
  classifyHardwareWalletVendor,
  getHardwareWalletCapabilityDecision,
} from "../../../src/services/hardwareWalletCapabilities";

describe("hardware wallet capability containment", () => {
  it.each([
    ["ledger", undefined, "ledger"],
    ["hardware", "Ledger Nano X", "ledger"],
    ["jade", "Jade Plus", "jade"],
    ["hardware", "Blockstream Jade Plus", "jade"],
    ["trezor", "Safe 5", "trezor"],
    ["hardware", "Trezor Safe 5", "trezor"],
  ] as const)("classifies %s / %s as %s", (type, model, expected) => {
    expect(classifyHardwareWalletVendor({ type, model })).toBe(expected);
  });

  it("uses model evidence ahead of a mutable generic type", () => {
    expect(
      classifyHardwareWalletVendor({
        type: "hardware",
        model: "Ledger Nano S Plus",
      }),
    ).toBe("ledger");
  });

  it.each(["ledger", "jade", "trezor"] as const)(
    "blocks every funds-controlling capability for %s",
    (vendor) => {
      for (const capability of [
        "import",
        "account_add",
        "display",
        "sign",
        "broadcast",
      ] as const) {
        const decision = getHardwareWalletCapabilityDecision(
          { type: vendor },
          capability,
        );
        expect(decision).toMatchObject({ allowed: false, vendor, capability });
        if (decision.allowed) {
          throw new Error(`Expected ${vendor} ${capability} to remain blocked`);
        }
        expect(decision.reason).not.toBe("");
        expect(decision.manifestId).toBe("wallet-safety-v1-2026-08-09");
      }
    },
  );

  it.each(["coldcard", "bitbox", "passport", "keystone", "seedsigner", "specter"])(
    "allows explicit non-target hardware type %s without claiming it is verified",
    type => {
      expect(getHardwareWalletCapabilityDecision({ type }, "import"))
        .toEqual({ allowed: true, vendor: null, capability: "import" });
    },
  );

  it.each(["ledgr", "custom", "watch-only"])(
    "fails closed for unrecognized nonempty device type %s",
    type => {
      expect(getHardwareWalletCapabilityDecision({ type }, "sign"))
        .toMatchObject({ allowed: false, vendor: "unidentified" });
    },
  );

  it.each([undefined, "", "unknown", "hardware"])(
    "fails closed for unidentified hardware type %s",
    (type) => {
      expect(getHardwareWalletCapabilityDecision({ type }, "import")).toMatchObject({
        allowed: false,
        vendor: "unidentified",
        capability: "import",
      });
    },
  );

  it("allows watch-only recovery import but blocks every funds-controlling follow-up", () => {
    expect(getHardwareWalletCapabilityDecision({ type: "watch_only" }, "import"))
      .toEqual({ allowed: true, vendor: null, capability: "import" });
    for (const capability of ["account_add", "display", "sign", "finalize", "broadcast"] as const) {
      expect(getHardwareWalletCapabilityDecision({ type: "watch_only" }, capability))
        .toMatchObject({ allowed: false, vendor: "unidentified", capability });
    }
  });

  it("blocks finalization as a distinct capability", () => {
    expect(getHardwareWalletCapabilityDecision({ type: "trezor" }, "finalize"))
      .toMatchObject({ allowed: false, vendor: "trezor", capability: "finalize" });
  });

  it("throws a stable typed server error without leaking device secrets", () => {
    expect(() =>
      assertHardwareWalletCapability(
        { type: "hardware", model: "Trezor Safe 5" },
        "sign",
      ),
    ).toThrow(ForbiddenError);

    try {
      assertHardwareWalletCapability(
        { type: "trezor", model: "Safe 5" },
        "sign",
      );
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
        details: {
          vendor: "trezor",
          capability: "sign",
          manifestId: "wallet-safety-v1-2026-08-09",
        },
      });
    }
  });

  it("fails closed when wallet signer provenance cannot be loaded", async () => {
    mockWalletRepository.findByIdWithDevices.mockResolvedValueOnce(null);

    await expect(assertWalletHardwareCapabilityById("missing-wallet", "sign"))
      .rejects.toThrow("signer provenance could not be loaded");
  });

  it("fails closed when a wallet has no linked signer provenance", () => {
    expect(() => assertWalletHardwareCapability({ devices: [] }, "sign"))
      .toThrow("no signer provenance is linked");
    expect(() => assertWalletHardwareCapability({ devices: [] }, "account_add"))
      .not.toThrow();
  });

  it("fails closed when the signer provenance collection is malformed", () => {
    expect(() => assertWalletHardwareCapability({ devices: null as never }, "display"))
      .toThrow("signer provenance is missing");
  });
});
