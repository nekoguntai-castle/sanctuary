import * as bitcoin from "bitcoinjs-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSingleSigPsbt,
  originalWindow,
  setSecureContext,
} from "./hardwareWallet/trezorAdapterTestHarness";

const mockInit = vi.fn();
const mockGetFeatures = vi.fn();
const mockGetDeviceState = vi.fn();
const mockGetPublicKey = vi.fn();
const mockSignTransaction = vi.fn();
const mockApiGet = vi.fn();
const mockValidatePsbtSigningRequest = vi.fn();

vi.mock("../../src/services/hardwareWallet/psbtAccountBinding", () => ({
  validatePsbtSigningRequest: (...args: unknown[]) =>
    mockValidatePsbtSigningRequest(...args),
}));

vi.mock("@trezor/connect-web", () => ({
  asDeviceUniquePath: (path: string) => path,
  default: {
    init: (...args: unknown[]) => mockInit(...args),
    getFeatures: (...args: unknown[]) => mockGetFeatures(...args),
    getDeviceState: (...args: unknown[]) => mockGetDeviceState(...args),
    getPublicKey: (...args: unknown[]) => mockGetPublicKey(...args),
    signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  },
}));

vi.mock("../../src/api/client", () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock("../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { TrezorAdapter } from "../../src/services/hardwareWallet/adapters/trezor";
import * as trezorSigning from "../../src/services/hardwareWallet/adapters/trezor/signPsbt";

const selectedDevice = {
  path: "webusb:dev-1",
  state: "seed@device:0",
  instance: 0,
};

const validatedSigningRequest = (request: { psbt: string }) => {
  const psbt = bitcoin.Psbt.fromBase64(request.psbt);
  return {
    psbt,
    context: {
      walletType: "single_sig",
      scriptType: "native_segwit",
      inputs: psbt.txInputs.map((_, inputIndex) => ({ inputIndex })),
      network: "mainnet",
      changeOutputs: [],
    },
    connectedSigner: { accountPath: "m/84'/0'/0'" },
    accountPath: "m/84'/0'/0'",
    network: "mainnet",
    changeOutputIndexes: [],
  };
};

describe("TrezorAdapter signing error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSecureContext(true);
    mockInit.mockResolvedValue(undefined);
    mockApiGet.mockRejectedValue(new Error("missing tx"));
    mockGetFeatures.mockResolvedValue({
      success: true,
      payload: {
        device_id: "dev-1",
        label: "My Trezor",
        internal_model: "T3T1",
        pin_protection: true,
        unlocked: false,
        passphrase_protection: true,
        major_version: 2,
        minor_version: 9,
        patch_version: 6,
      },
      device: { path: selectedDevice.path, instance: selectedDevice.instance },
    });
    mockGetDeviceState.mockResolvedValue({
      success: true,
      payload: { state: selectedDevice.state },
      device: selectedDevice,
    });
    mockGetPublicKey.mockResolvedValue({
      success: true,
      payload: {
        xpub: "xpub-from-device",
        descriptor:
          "wpkh([deadbeef/84h/0h/0h]xpub-from-device/<0;1>/*)#checksum",
        fingerprint: 0x12345678,
        depth: 3,
        childNum: 0x80000000,
      },
      device: selectedDevice,
    });
    mockValidatePsbtSigningRequest.mockImplementation(validatedSigningRequest);
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it("preserves non-Error failures from the signing boundary", async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    vi.spyOn(trezorSigning, "signPsbtWithTrezor").mockRejectedValueOnce(
      "validation transport failed",
    );

    await expect(adapter.signPSBT({ psbt: "not-parsed" })).rejects.toBe(
      "validation transport failed",
    );
    expect(adapter.isConnected()).toBe(true);
  });

  it.each([
    ["Cancelled", "Transaction rejected on Trezor"],
    ["PIN invalid", "Incorrect PIN. Please try again."],
    ["Passphrase denied", "Passphrase entry cancelled."],
    [
      "Device disconnected",
      "Trezor disconnected. Please reconnect and try again.",
    ],
    ["Forbidden key path", "Trezor blocked this derivation path"],
    [
      "Wrong derivation path",
      "The derivation path does not match your Trezor account",
    ],
    ["mystery failure", "Failed to sign with Trezor: mystery failure"],
  ])("maps signPSBT error branch: %s", async (deviceError, expectedMessage) => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    const { psbt } = createSingleSigPsbt();
    mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: { error: deviceError },
      device: selectedDevice,
    });

    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      }),
    ).rejects.toThrow(expectedMessage);
  });

  it("uses the signing fallback when the error payload omits its message", async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();
    const { psbt } = createSingleSigPsbt();
    mockSignTransaction.mockResolvedValueOnce({
      success: false,
      payload: {},
      device: selectedDevice,
    });

    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      }),
    ).rejects.toThrow("Failed to sign with Trezor: Signing failed");
  });

  it("maps invalid PSBT errors from the signPSBT catch path", async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    await expect(
      adapter.signPSBT({
        psbt: "not-a-psbt",
        inputPaths: [],
      }),
    ).rejects.toThrow("Failed to sign with Trezor");
  });
});
