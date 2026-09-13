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

const mockInit = vi.fn();
const mockGetFeatures = vi.fn();
const mockGetDeviceState = vi.fn();
const mockGetPublicKey = vi.fn();
const mockGetAddress = vi.fn();

vi.mock("@trezor/connect-web", () => ({
  asDeviceUniquePath: (path: string) => path,
  default: {
    init: (...args: unknown[]) => mockInit(...args),
    getFeatures: (...args: unknown[]) => mockGetFeatures(...args),
    getDeviceState: (...args: unknown[]) => mockGetDeviceState(...args),
    getPublicKey: (...args: unknown[]) => mockGetPublicKey(...args),
    getAddress: (...args: unknown[]) => mockGetAddress(...args),
  },
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    setSecureContext(true);
    mockInit.mockResolvedValue(undefined);
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
        descriptor: "wpkh([deadbeef/84h/0h/0h]xpub-from-device/<0;1>/*)#checksum",
        fingerprint: 0x12345678,
        depth: 3,
        childNum: 0x80000000,
      },
      device: selectedDevice,
    });
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
    const adapter = new TrezorAdapter();
    await adapter.connect();

    // Mainnet account index 1 must not be misread as testnet via an "/1'/" substring match.
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: "xpub-mainnet-account-1", fingerprint: 0xabcdef12 },
      device: selectedDevice,
    });
    await adapter.getXpub("m/84'/0'/1'/0/0");
    expect(mockGetPublicKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84'/0'/1'/0/0", coin: "Bitcoin" }),
    );

    // A genuine testnet path (coin type 1) is still classified as testnet.
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: "xpub-testnet", fingerprint: 0xabcdef12 },
      device: selectedDevice,
    });
    await adapter.getXpub("m/84'/1'/0'/0/0");
    expect(mockGetPublicKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84'/1'/0'/0/0", coin: "Testnet" }),
    );

    // 'h' hardened notation for the coin type is parsed the same way.
    mockGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { xpub: "xpub-mainnet-h", fingerprint: 0xabcdef12 },
      device: selectedDevice,
    });
    await adapter.getXpub("m/84h/0h/1h/0/0");
    expect(mockGetPublicKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84h/0h/1h/0/0", coin: "Bitcoin" }),
    );
  });

  it("derives the verifyAddress coin from the BIP44 coin-type segment, not a path substring", async () => {
    const adapter = new TrezorAdapter();
    await adapter.connect();

    // Mainnet account index 1 must not be misread as testnet via an "/1'/" substring match.
    mockGetAddress.mockResolvedValueOnce({
      success: true,
      payload: { address: "bc1qexpected", path: [], serializedPath: "m/84'/0'/1'/0/0" },
      device: selectedDevice,
    });
    await adapter.verifyAddress("m/84'/0'/1'/0/0", "bc1qexpected");
    expect(mockGetAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84'/0'/1'/0/0", coin: "Bitcoin" }),
    );

    // A genuine testnet path (coin type 1) is still classified as testnet.
    mockGetAddress.mockResolvedValueOnce({
      success: true,
      payload: { address: "tb1qexpected", path: [], serializedPath: "m/84'/1'/0'/0/0" },
      device: selectedDevice,
    });
    await adapter.verifyAddress("m/84'/1'/0'/0/0", "tb1qexpected");
    expect(mockGetAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "m/84'/1'/0'/0/0", coin: "Testnet" }),
    );

    // A malformed path (no parseable coin-type segment) does not fall back to testnet.
    mockGetAddress.mockResolvedValueOnce({
      success: true,
      payload: { address: "bc1qexpected", path: [], serializedPath: "not-a-path" },
      device: selectedDevice,
    });
    await adapter.verifyAddress("not-a-path", "bc1qexpected");
    expect(mockGetAddress).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "not-a-path", coin: "Bitcoin" }),
    );
  });
});
