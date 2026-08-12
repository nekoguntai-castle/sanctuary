import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as accountImportUtils from "../../../../../src/components/DeviceDetail/accounts/accountImportUtils";
import * as hardwareIdentity from "../../../../../src/services/hardwareWallet/identity";
import {
  getDeviceTypeFromDeviceModel,
  useAddAccountFlow,
} from "../../../../../src/components/DeviceDetail/accounts/hooks/useAddAccountFlow";

const parseDeviceJsonMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const getAllXpubsMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const getDeviceMock = vi.hoisted(() => vi.fn());
const addDeviceAccountMock = vi.hoisted(() => vi.fn());
const extractFromUrResultMock = vi.hoisted(() => vi.fn());
const normalizeDerivationPathMock = vi.hoisted(() =>
  vi.fn((path: string) => path),
);

const loggerSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const decoderConfig = vi.hoisted(() => ({
  bytesQueue: [] as Array<{
    progress?: number;
    complete?: boolean;
    completeQueue?: boolean[];
    success?: boolean;
    rawBytes?: Uint8Array;
  }>,
  urQueue: [] as Array<{
    progress?: number;
    complete?: boolean;
    completeQueue?: boolean[];
    success?: boolean;
    registryType?: unknown;
  }>,
}));

vi.mock("@ngraveio/bc-ur", () => {
  class URDecoder {
    private cfg: {
      progress?: number;
      complete?: boolean;
      completeQueue?: boolean[];
      success?: boolean;
      rawBytes?: Uint8Array;
    };

    constructor() {
      this.cfg = decoderConfig.bytesQueue.shift() || {};
    }

    receivePart(_part: string) {}

    estimatedPercentComplete() {
      return this.cfg.progress ?? 0;
    }

    isComplete() {
      if (this.cfg.completeQueue && this.cfg.completeQueue.length > 0) {
        return this.cfg.completeQueue.shift();
      }
      return this.cfg.complete ?? false;
    }

    isSuccess() {
      return this.cfg.success ?? true;
    }

    resultUR() {
      return {
        decodeCBOR: () => this.cfg.rawBytes || new TextEncoder().encode("{}"),
      };
    }
  }

  return { URDecoder };
});

vi.mock("@keystonehq/bc-ur-registry", () => {
  class URRegistryDecoder {
    private cfg: {
      progress?: number;
      complete?: boolean;
      completeQueue?: boolean[];
      success?: boolean;
      registryType?: unknown;
    };

    constructor() {
      this.cfg = decoderConfig.urQueue.shift() || {};
    }

    receivePart(_part: string) {}

    estimatedPercentComplete() {
      return this.cfg.progress ?? 0;
    }

    isComplete() {
      if (this.cfg.completeQueue && this.cfg.completeQueue.length > 0) {
        return this.cfg.completeQueue.shift();
      }
      return this.cfg.complete ?? false;
    }

    isSuccess() {
      return this.cfg.success ?? true;
    }

    resultRegistryType() {
      return this.cfg.registryType;
    }
  }

  return { URRegistryDecoder };
});

vi.mock("../../../../../src/services/deviceParsers", () => ({
  parseDeviceJson: parseDeviceJsonMock,
}));

vi.mock("../../../../../src/services/hardwareWallet/runtime", () => ({
  hardwareWalletService: {
    connect: connectMock,
    getAllXpubs: getAllXpubsMock,
    getAllXpubsWithFailures: async (callback: unknown) => {
      const value = await getAllXpubsMock(callback);
      return Array.isArray(value)
        ? { results: value, failures: [], totalPaths: value.length }
        : value;
    },
    disconnect: disconnectMock,
  },
  DeviceType: {},
}));

vi.mock("../../../../../src/api/devices", () => ({
  getDevice: getDeviceMock,
  addDeviceAccount: addDeviceAccountMock,
}));

vi.mock("../../../../../src/components/DeviceDetail/accounts/urHelpers", () => ({
  extractFromUrResult: extractFromUrResultMock,
  normalizeDerivationPath: normalizeDerivationPathMock,
}));

vi.mock("../../../../../src/utils/logger", () => ({
  createLogger: () => loggerSpies,
}));

const defaultDevice = {
  id: "device-1",
  type: "ledger",
  label: "Ledger",
  fingerprint: "abcd1234",
  accounts: [],
};

const onCloseMock = vi.fn();
const onDeviceUpdatedMock = vi.fn();

function renderFlowHook(deviceOverrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    useAddAccountFlow({
      deviceId: "device-1",
      device: { ...defaultDevice, ...deviceOverrides } as any,
      chainEnvironment: "mainnet",
      onClose: onCloseMock,
      onDeviceUpdated: onDeviceUpdatedMock,
    }),
  );
}

describe("useAddAccountFlow branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decoderConfig.bytesQueue = [];
    decoderConfig.urQueue = [];

    connectMock.mockResolvedValue({ connected: true, fingerprint: "abcd1234" });
    getAllXpubsMock.mockResolvedValue([]);
    disconnectMock.mockResolvedValue(undefined);
    getDeviceMock.mockResolvedValue({ ...defaultDevice });
    addDeviceAccountMock.mockResolvedValue(undefined);
    parseDeviceJsonMock.mockReturnValue(null);
    extractFromUrResultMock.mockReturnValue(null);
    normalizeDerivationPathMock.mockImplementation((path: string) => path);
  });

  it("maps device models to USB-supported types including trezor and jade", () => {
    expect(
      getDeviceTypeFromDeviceModel({ type: "Trezor Model T" } as any),
    ).toBe("trezor");
    expect(getDeviceTypeFromDeviceModel({ type: "ledger nano x" } as any)).toBe(
      "ledger",
    );
    expect(getDeviceTypeFromDeviceModel({ type: "coldcard mk4" } as any)).toBe(
      "coldcard",
    );
    expect(getDeviceTypeFromDeviceModel({ type: "bitbox02" } as any)).toBe(
      "bitbox",
    );
    expect(getDeviceTypeFromDeviceModel({ type: "jade" } as any)).toBe("jade");
    expect(getDeviceTypeFromDeviceModel({ type: "specter" } as any)).toBeNull();
  });

  it("returns early for file upload without files and empty QR payload", () => {
    const { result } = renderFlowHook();

    act(() => {
      result.current.handleFileUpload({ target: { files: [] } } as any);
      result.current.handleQrScan([]);
    });

    expect(parseDeviceJsonMock).not.toHaveBeenCalled();
  });

  it("rejects plain account and xpub QR payloads without a fingerprint", async () => {
    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/0'",
          xpub: "xpub-plain-account",
        },
      ],
      format: "generic",
    });
    const accountsFlow = renderFlowHook();
    act(() => {
      accountsFlow.result.current.handleQrScan([{ rawValue: "plain-accounts-without-fingerprint" }]);
    });
    await waitFor(() =>
      expect(accountsFlow.result.current.addAccountError).toMatch(/master fingerprint/i),
    );
    accountsFlow.unmount();

    parseDeviceJsonMock.mockReturnValueOnce({
      xpub: "xpub-plain",
      derivationPath: "m/84'/0'/1'",
      format: "generic",
    });
    const xpubFlow = renderFlowHook();
    act(() => {
      xpubFlow.result.current.handleQrScan([{ rawValue: "plain-xpub-without-fingerprint" }]);
    });
    await waitFor(() =>
      expect(xpubFlow.result.current.addAccountError).toMatch(/master fingerprint/i),
    );
  });

  it("rejects a registry UR account without fingerprint identity evidence", async () => {
    decoderConfig.urQueue.push({
      progress: 1,
      complete: true,
      success: true,
      registryType: { kind: "crypto-hdkey" },
    });
    extractFromUrResultMock.mockReturnValue({
      xpub: "xpub-ur",
      path: "m/84'/0'/2'",
    });

    const { result } = renderFlowHook();
    act(() => {
      result.current.handleQrScan([{ rawValue: "ur:crypto-hdkey/identity" }]);
    });

    await waitFor(() => expect(result.current.addAccountError).toMatch(/master fingerprint/i));
  });

  it("uses a safe generic identity error when verification throws a non-Error", async () => {
    const identitySpy = vi
      .spyOn(hardwareIdentity, "requireMatchingMasterFingerprint")
      .mockImplementationOnce(() => {
        throw "identity-verification-failed";
      });
    parseDeviceJsonMock.mockReturnValueOnce({
      xpub: "xpub-plain",
      derivationPath: "m/84'/0'/3'",
      fingerprint: "abcd1234",
      format: "generic",
    });

    const { result } = renderFlowHook();
    act(() => {
      result.current.handleQrScan([{ rawValue: "plain-identity" }]);
    });

    await waitFor(() =>
      expect(result.current.addAccountError).toBe("Invalid imported device identity"),
    );
    identitySpy.mockRestore();
  });

  it("reuses bytes decoder after an incomplete part and rejects accounts without fingerprint", async () => {
    decoderConfig.bytesQueue.push({
      progress: 0.5,
      completeQueue: [false, true],
      success: true,
      rawBytes: new TextEncoder().encode('{"accounts":[{"xpub":"xpub-a"}]}'),
    });
    parseDeviceJsonMock.mockReturnValue({
      accounts: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/1'",
          xpub: "xpub-a",
        },
      ],
    });

    const { result } = renderFlowHook({ accounts: undefined });

    act(() => {
      result.current.handleQrScan([{ rawValue: "ur:bytes/1-2" }]);
    });
    expect(result.current.parsedAccounts).toHaveLength(0);

    act(() => {
      result.current.handleQrScan([{ rawValue: "ur:bytes/2-2" }]);
    });

    await waitFor(() => expect(result.current.addAccountError).toMatch(/master fingerprint/i));
    expect(result.current.parsedAccounts).toHaveLength(0);
  });

  it("rejects bytes UR xpub-only payload without master fingerprint", async () => {
    decoderConfig.bytesQueue.push({
      progress: 1,
      complete: true,
      success: true,
      rawBytes: new TextEncoder().encode('{"xpub":"xpub-b"}'),
    });
    parseDeviceJsonMock.mockReturnValue({
      xpub: "xpub-b",
      derivationPath: "m/84'/0'/2'",
    });

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: "ur:bytes/single" }]);
    });

    await waitFor(() => expect(result.current.addAccountError).toMatch(/master fingerprint/i));
    expect(result.current.parsedAccounts).toHaveLength(0);
  });

  it("surfaces bytes UR extraction failure when decoded payload has no accounts or xpub", async () => {
    decoderConfig.bytesQueue.push({
      progress: 1,
      complete: true,
      success: true,
      rawBytes: new TextEncoder().encode("{}"),
    });
    parseDeviceJsonMock.mockReturnValue({});

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: "ur:bytes/bad" }]);
    });

    await waitFor(() =>
      expect(result.current.addAccountError).toBe(
        "Could not extract accounts from ur:bytes",
      ),
    );
  });

  it("surfaces bytes UR extraction failure when the decoded payload is unparseable", async () => {
    decoderConfig.bytesQueue.push({
      progress: 1,
      complete: true,
      success: true,
      rawBytes: new TextEncoder().encode("not-json"),
    });
    parseDeviceJsonMock.mockReturnValue(null);

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: "ur:bytes/null" }]);
    });

    await waitFor(() =>
      expect(result.current.addAccountError).toBe(
        "Could not extract accounts from ur:bytes",
      ),
    );
  });

  it("reuses UR registry decoder and rejects a missing normalized derivation path", async () => {
    decoderConfig.urQueue.push({
      progress: 0.6,
      completeQueue: [false, true],
      success: true,
      registryType: { kind: "crypto-hdkey" },
    });
    extractFromUrResultMock.mockReturnValue({
      xpub: "xpub-ur",
      path: "m/48'/0'/0'/2'",
      fingerprint: "abcd1234",
    });
    normalizeDerivationPathMock.mockReturnValueOnce(undefined as any);

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: "ur:crypto-hdkey/1-2" }]);
    });
    expect(result.current.parsedAccounts).toHaveLength(0);

    act(() => {
      result.current.handleQrScan([{ rawValue: "ur:crypto-hdkey/2-2" }]);
    });

    await waitFor(() => expect(result.current.addAccountError).toBe("Could not extract xpub from UR"));
    expect(result.current.parsedAccounts).toHaveLength(0);
  });

  it("handles UR decode failure and non-Error exceptions in decoder processing", async () => {
    decoderConfig.urQueue.push({
      progress: 1,
      complete: true,
      success: false,
      registryType: { kind: "crypto-hdkey" },
    });
    const first = renderFlowHook();
    act(() => {
      first.result.current.handleQrScan([{ rawValue: "ur:" }]);
    });
    await waitFor(() =>
      expect(first.result.current.addAccountError).toBe("UR decode failed"),
    );
    first.unmount();

    decoderConfig.urQueue.push({
      progress: 1,
      complete: true,
      success: true,
      registryType: { kind: "crypto-hdkey" },
    });
    extractFromUrResultMock.mockImplementationOnce(() => {
      throw "decode-string-error";
    });
    const second = renderFlowHook();
    act(() => {
      second.result.current.handleQrScan([{ rawValue: "ur:crypto-hdkey/1-1" }]);
    });
    await waitFor(() =>
      expect(second.result.current.addAccountError).toBe(
        "Failed to decode UR QR code",
      ),
    );
  });

  it("handles non-UR xpub parsing path and camera not-allowed error branch", async () => {
    parseDeviceJsonMock.mockReturnValueOnce({
      xpub: "xpub-plain",
      derivationPath: "m/84'/0'/3'",
      fingerprint: "abcd1234",
    });

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: "plain-payload" }]);
    });
    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(1));
    expect(result.current.importFingerprint).toBe("abcd1234");

    act(() => {
      result.current.handleCameraError(
        Object.assign(new Error("denied"), { name: "NotAllowedError" }),
      );
    });
    expect(result.current.cameraError).toBe(
      "Camera access denied. Please allow camera permissions.",
    );
  });

  it("uses empty matching account fallback when import processing omits matchingAccounts", async () => {
    const processSpy = vi
      .spyOn(accountImportUtils, "processImportedAccounts")
      .mockReturnValueOnce({
        newAccounts: [
          {
            purpose: "single_sig",
            scriptType: "native_segwit",
            derivationPath: "m/84'/0'/6'",
            xpub: "xpub-6",
          },
        ],
      } as any);

    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/6'",
          xpub: "xpub-6",
        },
      ],
      fingerprint: "abcd1234",
    });

    const { result } = renderFlowHook({ accounts: undefined });

    act(() => {
      result.current.handleQrScan([{ rawValue: "plain-accounts" }]);
    });

    await waitFor(() => expect(result.current.accountConflict).not.toBeNull());
    expect(result.current.accountConflict?.matchingAccounts).toEqual([]);
    processSpy.mockRestore();
  });

  it("covers USB unsupported model, accounts fallback path, and non-Error connect failures", async () => {
    const unsupported = renderFlowHook({ type: "specter" });
    await act(async () => {
      await unsupported.result.current.handleAddAccountsViaUsb();
    });
    expect(unsupported.result.current.addAccountError).toBe(
      "USB connection not supported for this device type",
    );
    expect(connectMock).not.toHaveBeenCalled();
    unsupported.unmount();

    getAllXpubsMock.mockResolvedValueOnce([
      {
        purpose: "single_sig",
        scriptType: "native_segwit",
        path: "m/84'/0'/0'",
        xpub: "xpub-new",
        fingerprint: "abcd1234",
      },
    ]);
    const success = renderFlowHook({ accounts: undefined });
    await act(async () => {
      await success.result.current.handleAddAccountsViaUsb();
    });
    expect(addDeviceAccountMock).toHaveBeenCalledWith(
      "device-1",
      expect.objectContaining({
        derivationPath: "m/84'/0'/0'",
        xpub: "xpub-new",
        masterFingerprint: "abcd1234",
      }),
    );
    expect(onDeviceUpdatedMock).toHaveBeenCalled();
    expect(onCloseMock).toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalled();
    success.unmount();

    connectMock.mockRejectedValueOnce("usb-string-error");
    const failed = renderFlowHook({ type: "ledger" });
    await act(async () => {
      await failed.result.current.handleAddAccountsViaUsb();
    });
    expect(failed.result.current.addAccountError).toBe(
      "Failed to connect to device",
    );
  });

  it("shows Ledger testnet guidance when USB import finds no new accounts after skipped coin-type 1 paths", async () => {
    getAllXpubsMock.mockResolvedValueOnce({
      results: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          path: "m/84'/0'/0'",
          xpub: "xpub-existing",
          fingerprint: "abcd1234",
        },
      ],
      failures: [
        {
          name: "Testnet Native SegWit (BIP-84)",
          path: "m/84'/1'/0'",
          message: "Bitcoin Test app not open",
        },
      ],
      totalPaths: 2,
    });

    const flow = renderFlowHook({
      type: "ledger",
      accounts: [{ derivationPath: "m/84'/0'/0'", xpub: "xpub-existing" }],
    });

    await act(async () => {
      await flow.result.current.handleAddAccountsViaUsb();
    });

    expect(addDeviceAccountMock).not.toHaveBeenCalled();
    expect(flow.result.current.addAccountError).toContain("Bitcoin Test app");
    expect(flow.result.current.addAccountError).toContain("testnet/signet");
  });

  it("binds a Jade Plus account-add connection to the selected chain and stored model", async () => {
    const flow = renderFlowHook({
      type: "Blockstream Jade Plus",
      model: { name: "Blockstream Jade Plus" },
    });

    await act(async () => {
      await flow.result.current.handleAddAccountsViaUsb();
    });

    expect(connectMock).toHaveBeenCalledWith("jade", {
      chainEnvironment: "mainnet",
      expectedModel: "Jade Plus",
    });
  });

  it("binds a base Jade account-add connection without promoting its model", async () => {
    const flow = renderFlowHook({
      type: "Blockstream Jade",
      model: { name: "Blockstream Jade" },
    });

    await act(async () => {
      await flow.result.current.handleAddAccountsViaUsb();
    });

    expect(connectMock).toHaveBeenCalledWith("jade", {
      chainEnvironment: "mainnet",
      expectedModel: "Jade",
    });
  });

  it("reports a generic error when every new USB account fails to save without skipped-path warnings", async () => {
    getAllXpubsMock.mockResolvedValueOnce({
      results: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          path: "m/84'/0'/9'",
          xpub: "xpub-new-but-rejected",
          fingerprint: "abcd1234",
        },
      ],
      failures: [],
      totalPaths: 1,
    });
    addDeviceAccountMock.mockRejectedValueOnce(new Error("duplicate account"));

    const flow = renderFlowHook({ type: "ledger", accounts: [] });

    await act(async () => {
      await flow.result.current.handleAddAccountsViaUsb();
    });

    expect(addDeviceAccountMock).toHaveBeenCalledTimes(1);
    expect(flow.result.current.addAccountError).toBe(
      "No accounts were added. Check for duplicate paths and try again.",
    );
    expect(onDeviceUpdatedMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it("includes skipped-path guidance when every new USB account fails to save", async () => {
    getAllXpubsMock.mockResolvedValueOnce({
      results: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          path: "m/84'/0'/9'",
          xpub: "xpub-new-but-rejected",
          fingerprint: "abcd1234",
        },
      ],
      failures: [
        {
          name: "Testnet Native SegWit (BIP-84)",
          path: "m/84'/1'/0'",
          message: "Bitcoin Test app not open",
        },
      ],
      totalPaths: 2,
    });
    addDeviceAccountMock.mockRejectedValueOnce(new Error("duplicate account"));

    const flow = renderFlowHook({ type: "ledger", accounts: [] });

    await act(async () => {
      await flow.result.current.handleAddAccountsViaUsb();
    });

    expect(addDeviceAccountMock).toHaveBeenCalledTimes(1);
    expect(flow.result.current.addAccountError).toContain(
      "No accounts were added. 1 testnet/signet path was not returned.",
    );
    expect(flow.result.current.addAccountError).toContain(
      "Skipped: Testnet Native SegWit (BIP-84) m/84'/1'/0'.",
    );
    expect(onDeviceUpdatedMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it("rejects a connected device that does not match the stored fingerprint before writes", async () => {
    connectMock.mockResolvedValueOnce({ connected: true, fingerprint: "deadbeef" });
    getAllXpubsMock.mockResolvedValueOnce([
      {
        purpose: "single_sig",
        scriptType: "native_segwit",
        path: "m/84'/0'/0'",
        xpub: "xpub-wrong-device",
        fingerprint: "deadbeef",
      },
    ]);
    const { result } = renderFlowHook({ accounts: [] });

    await act(async () => result.current.handleAddAccountsViaUsb());

    expect(result.current.addAccountError).toMatch(/fingerprint mismatch/i);
    expect(addDeviceAccountMock).not.toHaveBeenCalled();
    expect(onDeviceUpdatedMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalled();
  });

  it("prevalidates every xpub identity before writing the first account", async () => {
    getAllXpubsMock.mockResolvedValueOnce([
      {
        purpose: "single_sig",
        scriptType: "native_segwit",
        path: "m/84'/0'/0'",
        xpub: "xpub-matching",
        fingerprint: "abcd1234",
      },
      {
        purpose: "single_sig",
        scriptType: "taproot",
        path: "m/86'/0'/0'",
        xpub: "xpub-wrong-device",
        fingerprint: "deadbeef",
      },
    ]);
    const { result } = renderFlowHook({ accounts: [] });

    await act(async () => result.current.handleAddAccountsViaUsb());

    expect(result.current.addAccountError).toMatch(/fingerprint mismatch/i);
    expect(addDeviceAccountMock).not.toHaveBeenCalled();
  });

  it("rejects missing master fingerprint evidence before account writes", async () => {
    getAllXpubsMock.mockResolvedValueOnce([
      {
        purpose: "single_sig",
        scriptType: "native_segwit",
        path: "m/84'/0'/0'",
        xpub: "xpub-no-identity",
        fingerprint: "",
      },
    ]);
    const { result } = renderFlowHook({ accounts: [] });

    await act(async () => result.current.handleAddAccountsViaUsb());

    expect(result.current.addAccountError).toMatch(/master fingerprint/i);
    expect(addDeviceAccountMock).not.toHaveBeenCalled();
  });

  it("skips unselected parsed accounts and handles non-Error refresh failures", async () => {
    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/4'",
          xpub: "xpub-4",
        },
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/5'",
          xpub: "xpub-5",
        },
      ],
      fingerprint: "abcd1234",
    });

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: "plain-two-accounts" }]);
    });
    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(2));

    act(() => {
      result.current.setSelectedParsedAccounts(new Set([0]));
    });

    getDeviceMock.mockRejectedValueOnce("refresh-string-error");
    await act(async () => {
      await result.current.handleAddParsedAccounts();
    });

    expect(addDeviceAccountMock).toHaveBeenCalledTimes(1);
    expect(addDeviceAccountMock).toHaveBeenCalledWith(
      "device-1",
      expect.objectContaining({
        derivationPath: "m/84'/0'/4'",
        xpub: "xpub-4",
        masterFingerprint: "abcd1234",
      }),
    );
    expect(result.current.addAccountError).toBe("Failed to add accounts");
  });

  it("uses Error.message when parsed account refresh throws an Error", async () => {
    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/7'",
          xpub: "xpub-7",
        },
      ],
      fingerprint: "abcd1234",
    });

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: "plain-one-account" }]);
    });
    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(1));

    getDeviceMock.mockRejectedValueOnce(new Error("refresh-error"));
    await act(async () => {
      await result.current.handleAddParsedAccounts();
    });

    expect(result.current.addAccountError).toBe("refresh-error");
  });
});
