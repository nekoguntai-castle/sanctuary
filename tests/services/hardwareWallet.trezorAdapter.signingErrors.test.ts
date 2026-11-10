import * as bitcoin from "bitcoinjs-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSingleSigPsbt,
  originalWindow,
  setSecureContext,
} from "./hardwareWallet/trezorAdapterTestHarness";
import {
  connectFail,
  connectOk,
  createFakeTrezorClient,
  type FakeTrezorClient,
} from "./hardwareWallet/trezorFakeClient";

const mockApiGet = vi.fn();
const mockValidatePsbtSigningRequest = vi.fn();

vi.mock("../../src/services/hardwareWallet/psbtAccountBinding", () => ({
  validatePsbtSigningRequest: (...args: unknown[]) =>
    mockValidatePsbtSigningRequest(...args),
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
  let client: FakeTrezorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    setSecureContext(true);
    client = createFakeTrezorClient();
    mockApiGet.mockRejectedValue(new Error("missing tx"));
    client.getFeatures.mockResolvedValue(
      connectOk(
        {
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
        { path: selectedDevice.path, instance: selectedDevice.instance },
      ),
    );
    client.getDeviceState.mockResolvedValue(
      connectOk({ state: selectedDevice.state }, selectedDevice),
    );
    client.getPublicKey.mockResolvedValue(
      connectOk(
        {
          xpub: "xpub-from-device",
          descriptor:
            "wpkh([deadbeef/84h/0h/0h]xpub-from-device/<0;1>/*)#checksum",
          fingerprint: 0x12345678,
          depth: 3,
          childNum: 0x80000000,
        },
        selectedDevice,
      ),
    );
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
    const adapter = new TrezorAdapter(client);
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
    const adapter = new TrezorAdapter(client);
    await adapter.connect();
    const { psbt } = createSingleSigPsbt();
    client.signTransaction.mockResolvedValueOnce(connectFail(deviceError));

    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      }),
    ).rejects.toThrow(expectedMessage);
  });

  it("uses the signing fallback when the error payload omits its message", async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();
    const { psbt } = createSingleSigPsbt();
    client.signTransaction.mockResolvedValueOnce(connectFail());

    await expect(
      adapter.signPSBT({
        psbt: psbt.toBase64(),
        inputPaths: ["m/84'/0'/0'/0/0"],
      }),
    ).rejects.toThrow("Failed to sign with Trezor: Signing failed");
  });

  it("maps invalid PSBT errors from the signPSBT catch path", async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    await expect(
      adapter.signPSBT({
        psbt: "not-a-psbt",
        inputPaths: [],
      }),
    ).rejects.toThrow("Failed to sign with Trezor");
  });
});
