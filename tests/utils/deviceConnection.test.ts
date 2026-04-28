import { describe, expect, it } from "vitest";
import {
  generateMissingFieldsWarning,
  getAvailableMethods,
  getDeviceTypeFromModel,
  isMethodAvailable,
  normalizeDerivationPath,
} from "../../utils/deviceConnection";

describe("deviceConnection utilities", () => {
  it("maps hardware models to known device types", () => {
    expect(
      getDeviceTypeFromModel({
        name: "Trezor Safe 3",
        manufacturer: "Trezor",
      } as any),
    ).toBe("trezor");
    expect(
      getDeviceTypeFromModel({ name: "Nano X", manufacturer: "Ledger" } as any),
    ).toBe("ledger");
    expect(
      getDeviceTypeFromModel({
        name: "Coldcard Mk4",
        manufacturer: "Coinkite",
      } as any),
    ).toBe("coldcard");
    expect(
      getDeviceTypeFromModel({
        name: "BitBox02",
        manufacturer: "ShiftCrypto",
      } as any),
    ).toBe("bitbox");
    expect(
      getDeviceTypeFromModel({
        name: "Passport",
        manufacturer: "Foundation",
      } as any),
    ).toBe("passport");
    expect(
      getDeviceTypeFromModel({
        name: "Jade",
        manufacturer: "Blockstream",
      } as any),
    ).toBe("jade");
    expect(
      getDeviceTypeFromModel({
        name: "Unknown Device",
        manufacturer: "Unknown",
      } as any),
    ).toBe("unknown");
  });

  it("normalizes derivation paths and auto-hardens standard BIP paths", () => {
    expect(normalizeDerivationPath("M/84h/0h/0h")).toBe("m/84'/0'/0'");
    expect(normalizeDerivationPath("84/0/0")).toBe("m/84'/0'/0'");
    expect(normalizeDerivationPath("m/44/1/2/0/0")).toBe("m/44'/1'/2'/0/0");
    expect(normalizeDerivationPath("m/84''/0/0")).toBe("m/84''/0'/0'");
  });

  it("does not auto-harden non-standard purpose paths", () => {
    expect(normalizeDerivationPath("m")).toBe("m/");
    expect(normalizeDerivationPath("m/100/0/0")).toBe("m/100/0/0");
    expect(normalizeDerivationPath("")).toBe("");
  });

  it("generates missing field warnings only when needed", () => {
    expect(
      generateMissingFieldsWarning({
        hasFingerprint: true,
        hasDerivationPath: true,
      }),
    ).toBeNull();

    expect(
      generateMissingFieldsWarning({
        hasFingerprint: false,
        hasDerivationPath: true,
      }),
    ).toContain("master fingerprint");

    expect(
      generateMissingFieldsWarning({
        hasFingerprint: false,
        hasDerivationPath: false,
      }),
    ).toContain("master fingerprint, derivation path");
  });

  it("checks method availability based on connectivity and security context", () => {
    expect(isMethodAvailable("manual", ["usb"], false)).toBe(true);
    expect(isMethodAvailable("usb", ["usb"], true)).toBe(true);
    expect(isMethodAvailable("usb", ["usb"], false)).toBe(false);
    expect(isMethodAvailable("qr_code", ["qr_code"], false)).toBe(false);
    expect(isMethodAvailable("sd_card", ["sd_card"], false)).toBe(true);
    expect(isMethodAvailable("qr_code", ["usb"], true)).toBe(false);
  });

  it("returns available methods and always includes manual fallback", () => {
    expect(getAvailableMethods(["usb", "qr_code", "bluetooth"], true)).toEqual([
      "usb",
      "qr_code",
      "manual",
    ]);
    expect(getAvailableMethods(["usb", "qr_code"], false)).toEqual(["manual"]);
    expect(getAvailableMethods([], true)).toEqual(["manual"]);
  });
});
