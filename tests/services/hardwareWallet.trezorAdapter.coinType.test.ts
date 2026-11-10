/**
 * Trezor coin-type classification tests
 *
 * Non-regression coverage for `trezor-getcoinforpath-substring-misclassifies-mainnet-account-1-as-testnet`:
 * `getCoinForPath` used to check whether a path contained the substring "/1'/" or "/1h/",
 * which misclassifies a mainnet path with account index 1 (e.g. m/84'/0'/1'/0/0) as testnet.
 * It now derives the coin from the parsed BIP44 coin-type segment via `isTestnetPath`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originalWindow, setSecureContext } from "./hardwareWallet/trezorAdapterTestHarness";
import {
  connectOk,
  createFakeTrezorClient,
  type FakeTrezorClient,
} from "./hardwareWallet/trezorFakeClient";

vi.mock("../../src/api/client", () => ({
  default: {
    get: vi.fn(),
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

const selectedDevice = {
  path: "webusb:dev-1",
  state: "seed@device:0",
  instance: 0,
};

describe("TrezorAdapter coin-type classification", () => {
  let client: FakeTrezorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    setSecureContext(true);
    client = createFakeTrezorClient();
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
          descriptor: "wpkh([deadbeef/84h/0h/0h]xpub-from-device/<0;1>/*)#checksum",
          fingerprint: 0x12345678,
          depth: 3,
          childNum: 0x80000000,
        },
        selectedDevice,
      ),
    );
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it("derives the getXpub coin from the BIP44 coin-type segment, not a path substring", async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    // Mainnet account index 1 must not be misread as testnet via an "/1'/" substring match.
    client.getPublicKey.mockResolvedValueOnce(connectOk({ xpub: "xpub-mainnet-account-1", fingerprint: 0xabcdef12 }, selectedDevice));
    await adapter.getXpub("m/84'/0'/1'/0/0");
    expect(client.getPublicKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84'/0'/1'/0/0", network: "mainnet" }),
    );

    // A genuine testnet path (coin type 1) is still classified as testnet.
    client.getPublicKey.mockResolvedValueOnce(connectOk({ xpub: "xpub-testnet", fingerprint: 0xabcdef12 }, selectedDevice));
    await adapter.getXpub("m/84'/1'/0'/0/0");
    expect(client.getPublicKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84'/1'/0'/0/0", network: "testnet" }),
    );

    // 'h' hardened notation for the coin type is parsed the same way.
    client.getPublicKey.mockResolvedValueOnce(connectOk({ xpub: "xpub-mainnet-h", fingerprint: 0xabcdef12 }, selectedDevice));
    await adapter.getXpub("m/84h/0h/1h/0/0");
    expect(client.getPublicKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84h/0h/1h/0/0", network: "mainnet" }),
    );
  });

  it("derives the verifyAddress coin from the BIP44 coin-type segment, not a path substring", async () => {
    const adapter = new TrezorAdapter(client);
    await adapter.connect();

    // Mainnet account index 1 must not be misread as testnet via an "/1'/" substring match.
    client.getAddress.mockResolvedValueOnce(connectOk({ address: "bc1qexpected" }, selectedDevice));
    await adapter.verifyAddress("m/84'/0'/1'/0/0", "bc1qexpected");
    expect(client.getAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84'/0'/1'/0/0", network: "mainnet" }),
    );

    // A genuine testnet path (coin type 1) is still classified as testnet.
    client.getAddress.mockResolvedValueOnce(connectOk({ address: "tb1qexpected" }, selectedDevice));
    await adapter.verifyAddress("m/84'/1'/0'/0/0", "tb1qexpected");
    expect(client.getAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84'/1'/0'/0/0", network: "testnet" }),
    );

    // A malformed path (no parseable coin-type segment) does not fall back to testnet.
    client.getAddress.mockResolvedValueOnce(connectOk({ address: "bc1qexpected" }, selectedDevice));
    await adapter.verifyAddress("not-a-path", "bc1qexpected");
    expect(client.getAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "not-a-path", network: "mainnet" }),
    );
  });
});
