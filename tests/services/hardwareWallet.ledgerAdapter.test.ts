/**
 * Ledger adapter coverage tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTransportCreate,
  mockTransportClose,
  mockUsbGetDevices,
  mockGetWalletXpub,
  mockGetWalletPublicKey,
  mockGetMasterFingerprint,
  mockGetAppAndVersion,
  mockGetExtendedPubkey,
  MockAppBtc,
  MockAppClient,
  mockPsbtFromBase64,
} = vi.hoisted(() => {
  const mockTransportCreate = vi.fn();
  const mockTransportClose = vi.fn();
  const mockUsbGetDevices = vi.fn();
  const mockGetWalletXpub = vi.fn();
  const mockGetWalletPublicKey = vi.fn();
  const mockGetMasterFingerprint = vi.fn();
  const mockGetAppAndVersion = vi.fn();
  const mockGetExtendedPubkey = vi.fn();
  const mockPsbtFromBase64 = vi.fn();

  const MockAppBtc = vi.fn(function MockAppBtc(this: any) {
    this.getWalletXpub = (...args: unknown[]) => mockGetWalletXpub(...args);
    this.getWalletPublicKey = (...args: unknown[]) =>
      mockGetWalletPublicKey(...args);
  });

  const MockAppClient = vi.fn(function MockAppClient(this: any) {
    this.getMasterFingerprint = (...args: unknown[]) =>
      mockGetMasterFingerprint(...args);
    this.getAppAndVersion = (...args: unknown[]) =>
      mockGetAppAndVersion(...args);
    this.getExtendedPubkey = (...args: unknown[]) =>
      mockGetExtendedPubkey(...args);
    this.signPsbt = vi.fn();
  });

  return {
    mockTransportCreate,
    mockTransportClose,
    mockUsbGetDevices,
    mockGetWalletXpub,
    mockGetWalletPublicKey,
    mockGetMasterFingerprint,
    mockGetAppAndVersion,
    mockGetExtendedPubkey,
    MockAppBtc,
    MockAppClient,
    mockPsbtFromBase64,
  };
});

vi.mock("@ledgerhq/hw-transport-webusb", () => ({
  default: {
    create: (...args: unknown[]) => mockTransportCreate(...args),
  },
}));

vi.mock("@ledgerhq/hw-app-btc", () => ({
  default: MockAppBtc,
}));

vi.mock("@ledgerhq/ledger-bitcoin", () => ({
  AppClient: MockAppClient,
  DefaultWalletPolicy: vi.fn(),
}));

vi.mock("bitcoinjs-lib", () => ({
  Psbt: {
    fromBase64: (...args: unknown[]) => mockPsbtFromBase64(...args),
  },
}));

vi.mock("../../utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@sanctuary/shared/utils/bitcoin", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sanctuary/shared/utils/bitcoin")>();
  return {
    ...actual,
    normalizeDerivationPath: (path: string) => path,
  };
});

import { LedgerAdapter } from "../../services/hardwareWallet/adapters/ledger";

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

function setWebUsbEnv(options: { secure?: boolean; withUsb?: boolean } = {}) {
  const { secure = true, withUsb = true } = options;
  Object.defineProperty(globalThis, "window", {
    value: {
      ...(originalWindow as object),
      isSecureContext: secure,
    },
    configurable: true,
  });

  const nav = withUsb
    ? {
        usb: { getDevices: (...args: unknown[]) => mockUsbGetDevices(...args) },
      }
    : {};

  Object.defineProperty(globalThis, "navigator", {
    value: nav,
    configurable: true,
  });
}

function makeUsbDevice(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: 0x2c97,
    productId: 0x0004,
    serialNumber: "abc123",
    opened: false,
    ...overrides,
  };
}

describe("LedgerAdapter", () => {
  beforeEach(() => {
    mockTransportCreate.mockReset();
    mockTransportClose.mockReset();
    mockUsbGetDevices.mockReset();
    mockGetWalletXpub.mockReset();
    mockGetWalletPublicKey.mockReset();
    mockGetMasterFingerprint.mockReset();
    mockGetAppAndVersion.mockReset();
    mockGetExtendedPubkey.mockReset();
    mockPsbtFromBase64.mockReset();
    MockAppBtc.mockClear();
    MockAppClient.mockClear();
    setWebUsbEnv({ secure: true, withUsb: true });
    mockUsbGetDevices.mockResolvedValue([]);
    mockTransportClose.mockResolvedValue(undefined);
    mockGetMasterFingerprint.mockResolvedValue("f00dbabe");
    mockGetAppAndVersion.mockResolvedValue({
      name: "Bitcoin",
      version: "2.2.4",
      flags: 0,
    });
    mockGetExtendedPubkey.mockResolvedValue("xpub-mock");
    mockGetWalletXpub.mockResolvedValue("xpub-mock");
    mockGetWalletPublicKey.mockResolvedValue({ bitcoinAddress: "bc1qabc" });
    mockPsbtFromBase64.mockReturnValue({
      data: { inputs: [] },
      toBase64: () => "psbt",
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  it("checks WebUSB support based on browser environment", () => {
    const adapter = new LedgerAdapter();
    expect(adapter.isSupported()).toBe(true);

    setWebUsbEnv({ secure: false, withUsb: true });
    expect(adapter.isSupported()).toBe(false);

    setWebUsbEnv({ secure: true, withUsb: false });
    expect(adapter.isSupported()).toBe(false);
  });

  it("returns empty authorized devices when unsupported", async () => {
    setWebUsbEnv({ secure: false, withUsb: true });
    const adapter = new LedgerAdapter();
    await expect(adapter.getAuthorizedDevices()).resolves.toEqual([]);
  });

  it("filters and maps authorized Ledger devices", async () => {
    const ledger = makeUsbDevice({ productId: 0x0004, opened: true });
    const nonLedger = makeUsbDevice({
      vendorId: 0x1234,
      productId: 0x9999,
      serialNumber: "zzz",
    });
    mockUsbGetDevices.mockResolvedValue([ledger, nonLedger]);

    const adapter = new LedgerAdapter();
    const devices = await adapter.getAuthorizedDevices();

    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe("ledger-11415-4-abc123");
    expect(devices[0].name).toBe("Ledger Nano X");
    expect(devices[0].connected).toBe(true);
  });

  it("maps unknown models, missing serials, and active in-memory connection state", async () => {
    const unknown = makeUsbDevice({
      productId: 0x9999,
      serialNumber: undefined,
      opened: false,
    });
    mockUsbGetDevices.mockResolvedValue([unknown]);

    const adapter = new LedgerAdapter();
    (adapter as any).connection = { device: unknown };
    const devices = await adapter.getAuthorizedDevices();

    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe("Ledger Device");
    expect(devices[0].id).toBe("ledger-11415-39321-unknown");
    expect(devices[0].connected).toBe(true);
  });

  it("gracefully handles getAuthorizedDevices errors", async () => {
    mockUsbGetDevices.mockRejectedValue(new Error("usb enumeration failed"));
    const adapter = new LedgerAdapter();
    await expect(adapter.getAuthorizedDevices()).resolves.toEqual([]);
  });

  it("throws friendly errors for unsupported and denied connection", async () => {
    const unsupported = new LedgerAdapter();
    setWebUsbEnv({ secure: false, withUsb: true });
    await expect(unsupported.connect()).rejects.toThrow(
      "WebUSB is not supported",
    );

    setWebUsbEnv({ secure: true, withUsb: true });
    mockTransportCreate.mockRejectedValueOnce(new Error("NotAllowedError"));
    const denied = new LedgerAdapter();
    await expect(denied.connect()).rejects.toThrow("Access denied");
  });

  it("maps common Ledger connect failure reasons", async () => {
    setWebUsbEnv({ secure: true, withUsb: true });

    mockTransportCreate.mockRejectedValueOnce(new Error("0x6d00"));
    await expect(new LedgerAdapter().connect()).rejects.toThrow(
      "open the Bitcoin app",
    );

    mockTransportCreate.mockRejectedValueOnce(
      new Error("device locked (0x6982)"),
    );
    await expect(new LedgerAdapter().connect()).rejects.toThrow(
      "Please unlock",
    );
  });

  it("closes previous transport before reconnect and maps generic connect errors", async () => {
    const adapter = new LedgerAdapter();
    const oldClose = vi.fn(async () => undefined);
    (adapter as any).connection = { transport: { close: oldClose } };

    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0001 }),
    };
    mockTransportCreate.mockResolvedValueOnce(transport);
    await adapter.connect();
    expect(oldClose).toHaveBeenCalled();

    mockTransportCreate.mockRejectedValueOnce(
      new Error("unexpected connect fail"),
    );
    await expect(new LedgerAdapter().connect()).rejects.toThrow(
      "Failed to connect: unexpected connect fail",
    );
  });

  it("connects successfully and exposes connected device state", async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0005, serialNumber: "xyz" }),
    };
    mockTransportCreate.mockResolvedValue(transport);

    const adapter = new LedgerAdapter();
    const device = await adapter.connect();

    expect(device.name).toBe("Ledger Nano S Plus");
    expect(device.id).toBe("ledger-11415-5-xyz");
    expect(device.connected).toBe(true);
    expect(device.fingerprint).toBe("f00dbabe");
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getDevice()?.id).toBe(device.id);
    expect(MockAppBtc).toHaveBeenCalledTimes(1);
    expect(MockAppClient).toHaveBeenCalledTimes(1);
  });

  it("continues connect when Ledger app metadata cannot be read", async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0005 }),
    };
    mockTransportCreate.mockResolvedValue(transport);
    mockGetAppAndVersion.mockRejectedValueOnce(new Error("app info unavailable"));

    const adapter = new LedgerAdapter();
    const device = await adapter.connect();

    expect(device.connected).toBe(true);
    expect(device.fingerprint).toBe("f00dbabe");
  });

  it("continues connect when an unknown fingerprint fetch error occurs", async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0007 }),
    };
    mockTransportCreate.mockResolvedValue(transport);
    mockGetMasterFingerprint.mockRejectedValueOnce(
      new Error("fingerprint read failed"),
    );

    const adapter = new LedgerAdapter();
    const device = await adapter.connect();

    expect(device.name).toBe("Ledger Flex");
    expect(device.fingerprint).toBeUndefined();
  });

  it("fails connect with an actionable message when the Bitcoin app is not ready", async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0005 }),
    };
    mockTransportCreate.mockResolvedValue(transport);
    mockGetMasterFingerprint.mockRejectedValueOnce(
      new Error("CLA_NOT_SUPPORTED 0x6e00"),
    );

    const adapter = new LedgerAdapter();

    await expect(adapter.connect()).rejects.toThrow("open the Bitcoin app");
    expect(mockTransportClose).toHaveBeenCalled();
  });

  it("keeps the Ledger readiness error if transport close also fails", async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0005 }),
    };
    mockTransportCreate.mockResolvedValue(transport);
    mockGetMasterFingerprint.mockRejectedValueOnce(
      new Error("CLA_NOT_SUPPORTED 0x6e00"),
    );
    mockTransportClose.mockRejectedValueOnce(new Error("close failed"));

    await expect(new LedgerAdapter().connect()).rejects.toThrow(
      "open the Bitcoin app",
    );
    expect(mockTransportClose).toHaveBeenCalled();
  });

  it("disconnects and clears internal device state", async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      transport: { close: (...args: unknown[]) => mockTransportClose(...args) },
    };
    (adapter as any).connectedDevice = {
      id: "ledger-1",
      type: "ledger",
      name: "Ledger",
      model: "Ledger",
      connected: true,
      fingerprint: "abcd",
    };

    await adapter.disconnect();

    expect(mockTransportClose).toHaveBeenCalled();
    expect(adapter.getDevice()).toBeNull();
    expect(adapter.isConnected()).toBe(false);
  });

  it("handles close errors during disconnect", async () => {
    const adapter = new LedgerAdapter();
    mockTransportClose.mockRejectedValueOnce(new Error("close failed"));
    (adapter as any).connection = {
      transport: { close: (...args: unknown[]) => mockTransportClose(...args) },
    };

    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(adapter.getDevice()).toBeNull();
  });

  it("requires connection for xpub/address/sign operations", async () => {
    const adapter = new LedgerAdapter();
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      "No device connected",
    );
    await expect(
      (adapter as any).getLedgerXpub("m/84'/0'/0'", 0x0488b21e),
    ).rejects.toThrow("No device connected");
    await expect((adapter as any).getMasterFingerprint()).resolves.toBe("");
    await expect(
      adapter.verifyAddress("m/84'/0'/0'/0/0", "bc1qxyz"),
    ).rejects.toThrow("No device connected");
    await expect(
      adapter.signPSBT({ psbt: "not-a-psbt", inputPaths: [] }),
    ).rejects.toThrow("No device connected");
  });

  it("uses a cached fingerprint when returning an xpub", async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      app: {
        getWalletXpub: (...args: unknown[]) => mockGetWalletXpub(...args),
      },
      appClient: {
        getMasterFingerprint: (...args: unknown[]) =>
          mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) =>
          mockGetExtendedPubkey(...args),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: "ledger-1",
      type: "ledger",
      name: "Ledger",
      model: "Ledger",
      connected: true,
      fingerprint: "cafebabe",
    };

    mockGetExtendedPubkey.mockResolvedValueOnce("xpub-cached-fingerprint");

    const result = await adapter.getXpub("m/84'/0'/0'");

    expect(result.fingerprint).toBe("cafebabe");
    expect(mockGetMasterFingerprint).not.toHaveBeenCalled();
  });

  it("returns xpub and maps getXpub/verify error branches", async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      app: {
        getWalletXpub: (...args: unknown[]) => mockGetWalletXpub(...args),
        getWalletPublicKey: (...args: unknown[]) =>
          mockGetWalletPublicKey(...args),
      },
      appClient: {
        getMasterFingerprint: (...args: unknown[]) =>
          mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) =>
          mockGetExtendedPubkey(...args),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: "ledger-1",
      type: "ledger",
      name: "Ledger",
      model: "Ledger",
      connected: true,
      fingerprint: "",
    };

    mockGetExtendedPubkey.mockResolvedValueOnce("tpub-testnet");
    const result = await adapter.getXpub("m/84'/1'/0'");
    expect(result).toEqual({
      xpub: "tpub-testnet",
      fingerprint: "f00dbabe",
      path: "m/84'/1'/0'",
    });
    expect(mockGetExtendedPubkey).toHaveBeenCalledWith("m/84'/1'/0'");
    expect(mockGetWalletXpub).not.toHaveBeenCalled();

    mockGetExtendedPubkey.mockRejectedValueOnce(
      new Error("new API unavailable"),
    );
    mockGetWalletXpub.mockResolvedValueOnce("xpub-fallback");
    const fallbackResult = await adapter.getXpub("m/84'/0'/0'");
    expect(fallbackResult.xpub).toBe("xpub-fallback");
    expect(mockGetWalletXpub).toHaveBeenCalledWith({
      path: "m/84'/0'/0'",
      xpubVersion: 0x0488b21e,
    });

    mockGetMasterFingerprint.mockRejectedValueOnce(new Error("fp read fail"));
    mockGetExtendedPubkey.mockResolvedValueOnce("xpub-mainnet");
    const noFpResult = await adapter.getXpub("m/84'/0'/0'");
    expect(noFpResult.fingerprint).toBe("");

    mockGetExtendedPubkey.mockRejectedValueOnce(new Error("0x6985 denied"));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      "Request rejected on Ledger",
    );

    mockGetExtendedPubkey.mockRejectedValueOnce(new Error("0x6d00"));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      "Bitcoin app not open on Ledger",
    );

    (adapter as any).connection.appName = "Bitcoin";
    mockGetExtendedPubkey.mockRejectedValueOnce(
      new Error("incorrect data 0x6a80"),
    );
    await expect(adapter.getXpub("m/84'/1'/0'")).rejects.toThrow(
      "Bitcoin Test app is required",
    );

    (adapter as any).connection.appName = undefined;
    mockGetExtendedPubkey.mockRejectedValueOnce(
      new Error("incorrect data 0x6a80"),
    );
    let missingAppMetadataMessage = "";
    try {
      await adapter.getXpub("m/84'/1'/1'");
    } catch (error) {
      missingAppMetadataMessage =
        error instanceof Error ? error.message : String(error);
    }
    expect(missingAppMetadataMessage).toContain(
      "Bitcoin Test app is required",
    );
    expect(missingAppMetadataMessage).not.toContain("currently running");

    (adapter as any).connection.appName = "Bitcoin Test";
    mockGetExtendedPubkey.mockRejectedValueOnce(
      new Error("incorrect data 0x6a80"),
    );
    mockGetWalletXpub.mockResolvedValueOnce("tpub-testnet-fallback");
    const testnetAppFallbackResult = await adapter.getXpub("m/84'/1'/2'");
    expect(testnetAppFallbackResult.xpub).toBe("tpub-testnet-fallback");

    mockGetExtendedPubkey.mockRejectedValueOnce(
      new Error("new API unavailable"),
    );
    mockGetWalletXpub.mockRejectedValueOnce(new Error("xpub failed"));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      "Failed to get xpub: xpub failed",
    );

    mockGetExtendedPubkey.mockResolvedValueOnce("");
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      "Ledger returned an empty xpub",
    );

    await expect(
      adapter.verifyAddress("m/84'/0'/0'/0/0", "bc1qabc"),
    ).resolves.toBe(true);

    mockGetWalletPublicKey.mockResolvedValueOnce({
      bitcoinAddress: "bc1qmismatch",
    });
    await expect(
      adapter.verifyAddress("m/84'/0'/0'/0/0", "bc1qabc"),
    ).resolves.toBe(false);

    mockGetWalletPublicKey.mockRejectedValueOnce(new Error("denied by user"));
    await expect(
      adapter.verifyAddress("m/84'/0'/0'/0/0", "bc1qabc"),
    ).resolves.toBe(false);

    mockGetWalletPublicKey.mockRejectedValueOnce(new Error("unexpected"));
    await expect(
      adapter.verifyAddress("m/84'/0'/0'/0/0", "bc1qabc"),
    ).rejects.toThrow("Failed to verify address");
  });

  it("maps signPSBT error categories to user-friendly messages", async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      app: {},
      appClient: {
        getMasterFingerprint: (...args: unknown[]) =>
          mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) =>
          mockGetExtendedPubkey(...args),
        signPsbt: vi.fn(),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: "ledger-1",
      type: "ledger",
      name: "Ledger",
      model: "Ledger",
      connected: true,
      fingerprint: "",
    };

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error("0x6985 denied");
    });
    await expect(
      adapter.signPSBT({ psbt: "x", inputPaths: [] }),
    ).rejects.toThrow("Transaction rejected on device");

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error("0x6d00");
    });
    await expect(
      adapter.signPSBT({ psbt: "x", inputPaths: [] }),
    ).rejects.toThrow("Bitcoin app not open on device");

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error("device locked");
    });
    await expect(
      adapter.signPSBT({ psbt: "x", inputPaths: [] }),
    ).rejects.toThrow("Device is locked");

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error("No device present");
    });
    await expect(
      adapter.signPSBT({ psbt: "x", inputPaths: [] }),
    ).rejects.toThrow("Device disconnected");

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error("unexpected");
    });
    await expect(
      adapter.signPSBT({ psbt: "x", inputPaths: [] }),
    ).rejects.toThrow("Failed to sign transaction: unexpected");
  });

  it("blocks Ledger multisig signing before wallet policy creation", async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      app: {},
      appClient: {
        getMasterFingerprint: (...args: unknown[]) =>
          mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) =>
          mockGetExtendedPubkey(...args),
        signPsbt: vi.fn(),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: "ledger-1",
      type: "ledger",
      name: "Ledger",
      model: "Ledger",
      connected: true,
      fingerprint: "",
    };

    mockPsbtFromBase64.mockReturnValueOnce({
      data: {
        inputs: [{
          bip32Derivation: [{ path: "m/48'/0'/0'/2'/0/0" }],
        }],
      },
      toBase64: () => "psbt",
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    });

    await expect(
      adapter.signPSBT({
        psbt: "multisig-psbt",
        inputPaths: ["m/48'/0'/0'/2'/0/0"],
      }),
    ).rejects.toThrow("Ledger multisig USB signing is blocked in this release.");
    expect(mockGetMasterFingerprint).not.toHaveBeenCalled();
    expect(mockGetExtendedPubkey).not.toHaveBeenCalled();
  });

  it("handles non-Error failures and no-op disconnect fallback paths", async () => {
    const connectNonError = new LedgerAdapter();
    mockTransportCreate.mockRejectedValueOnce({
      reason: "plain-object",
    } as any);
    await expect(connectNonError.connect()).rejects.toThrow(
      "Failed to connect: Unknown error",
    );

    const adapter = new LedgerAdapter();
    await expect(adapter.disconnect()).resolves.toBeUndefined();

    (adapter as any).connection = {
      app: {
        getWalletXpub: (...args: unknown[]) => mockGetWalletXpub(...args),
        getWalletPublicKey: (...args: unknown[]) =>
          mockGetWalletPublicKey(...args),
      },
      appClient: {
        getMasterFingerprint: (...args: unknown[]) =>
          mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) =>
          mockGetExtendedPubkey(...args),
        signPsbt: vi.fn(),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: "ledger-1",
      type: "ledger",
      name: "Ledger",
      model: "Ledger",
      connected: true,
      fingerprint: "",
    };

    mockGetExtendedPubkey.mockRejectedValueOnce("xpub-non-error" as any);
    mockGetWalletXpub.mockRejectedValueOnce("fallback-non-error" as any);
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(
      "Failed to get xpub: Unknown error",
    );

    mockGetWalletPublicKey.mockRejectedValueOnce(42 as any);
    await expect(
      adapter.verifyAddress("m/84'/0'/0'/0/0", "bc1qabc"),
    ).rejects.toThrow("Failed to verify address: Unknown error");

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw "sign-non-error";
    });
    await expect(
      adapter.signPSBT({ psbt: "x", inputPaths: [] }),
    ).rejects.toThrow("Failed to sign transaction: Unknown error");
  });
});
