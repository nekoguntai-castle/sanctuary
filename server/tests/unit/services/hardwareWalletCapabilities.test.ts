import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../../src/errors";

const mockWalletRepository = vi.hoisted(() => ({
  findByIdWithDevices: vi.fn(),
}));

vi.mock("../../../src/repositories", () => ({
  walletRepository: mockWalletRepository,
}));

import {
  HARDWARE_WALLET_CAPABILITIES,
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  HARDWARE_WALLET_IMPLEMENTATION_INVENTORY,
  HARDWARE_WALLET_VENDORS,
  getHardwareWalletCapabilityRow,
} from "@sanctuary/shared/constants/hardwareWalletCapabilities";
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

  it.each(HARDWARE_WALLET_VENDORS)(
    "blocks every funds-controlling capability for %s",
    (vendor) => {
      for (const capability of HARDWARE_WALLET_CAPABILITIES) {
        const decision = getHardwareWalletCapabilityDecision(
          { type: vendor },
          capability,
        );
        expect(decision).toMatchObject({ allowed: false, vendor, capability });
        if (decision.allowed) {
          throw new Error(`Expected ${vendor} ${capability} to remain blocked`);
        }
        expect(decision.reason).not.toBe("");
        expect(decision.manifestId).toBe(HARDWARE_WALLET_CAPABILITY_MANIFEST_ID);
      }
    },
  );

  it.each(["coldcard", "bitbox", "bitbox02", "passport", "keystone", "seedsigner", "specter", "generic"])(
    "blocks explicit unverified hardware type %s",
    type => {
      expect(getHardwareWalletCapabilityDecision({ type }, "import"))
        .toMatchObject({ allowed: false, capability: "import" });
    },
  );

  it("classifies every baseline catalog model and blocks all capabilities", () => {
    for (const inventoryRow of HARDWARE_WALLET_IMPLEMENTATION_INVENTORY) {
      for (const model of [
        ...inventoryRow.aliases,
        ...inventoryRow.catalogModelSlugs,
        ...inventoryRow.catalogModelNames,
      ]) {
        expect(classifyHardwareWalletVendor({ model })).toBe(inventoryRow.vendor);
        expect(getHardwareWalletCapabilityRow({ model }, "sign"))
          .toMatchObject({ vendor: inventoryRow.vendor, capability: "sign" });
        for (const capability of HARDWARE_WALLET_CAPABILITIES) {
          expect(getHardwareWalletCapabilityDecision({ model }, capability))
            .toMatchObject({ allowed: false, vendor: inventoryRow.vendor, capability });
        }
      }
    }
  });

  it("covers every independently seeded hardware model slug", () => {
    const seed = readFileSync(resolve("prisma/seed.ts"), "utf8");
    const catalogSource = seed.match(
      /const hardwareDeviceModels = \[([\s\S]*?)\n\];/,
    )?.[1];
    expect(catalogSource).toBeDefined();
    const catalogSlugs = [...catalogSource!.matchAll(/slug: "([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    const catalogNames = [...catalogSource!.matchAll(/name: "([^"]+)"/g)]
      .map((match) => match[1])
      .sort();
    const inventorySlugs = HARDWARE_WALLET_IMPLEMENTATION_INVENTORY
      .flatMap((row) => row.catalogModelSlugs)
      .sort();
    const inventoryNames = HARDWARE_WALLET_IMPLEMENTATION_INVENTORY
      .flatMap((row) => row.catalogModelNames)
      .sort();
    expect(catalogSlugs).toEqual(inventorySlugs);
    expect(catalogNames).toEqual(inventoryNames);
  });

  it("rejects ambiguous or token-spoofed identities", () => {
    expect(classifyHardwareWalletVendor({ type: "ledger", model: "Trezor Safe 5" })).toBeNull();
    expect(classifyHardwareWalletVendor({ type: "notledger" })).toBeNull();
    expect(classifyHardwareWalletVendor({ model: "Ledger Nano X drifted" })).toBeNull();
    expect(getHardwareWalletCapabilityDecision(
      { type: "ledger", model: "Trezor Safe 5" },
      "sign",
    )).toMatchObject({ allowed: false, vendor: "unidentified" });
  });

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
          manifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
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

  it("checks every linked signer when wallet provenance is loaded by id", async () => {
    mockWalletRepository.findByIdWithDevices.mockResolvedValueOnce({
      devices: [
        { device: { type: "watch_only" } },
        { device: { type: "watch_only" } },
      ],
    });

    await expect(assertWalletHardwareCapabilityById("wallet-1", "import"))
      .resolves.toBeUndefined();
  });

  it("fails closed when the signer provenance collection is malformed", () => {
    expect(() => assertWalletHardwareCapability({ devices: null as never }, "display"))
      .toThrow("signer provenance is missing");
  });
});
