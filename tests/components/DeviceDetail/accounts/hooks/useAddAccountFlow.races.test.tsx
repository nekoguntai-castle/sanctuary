import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddAccountFlow } from "../../../../../src/components/DeviceDetail/accounts/hooks/useAddAccountFlow";

const parseDeviceJsonMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const getAllXpubsMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const connectionLease = vi.hoisted(() => ({}));
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

vi.mock("@ngraveio/bc-ur", () => ({
  URDecoder: class URDecoder {
    receivePart(_part: string) {}
    estimatedPercentComplete() { return 0; }
    isComplete() { return false; }
    isSuccess() { return true; }
    resultUR() { return { decodeCBOR: () => new TextEncoder().encode("{}") }; }
  },
}));

vi.mock("@keystonehq/bc-ur-registry", () => ({
  URRegistryDecoder: class URRegistryDecoder {
    receivePart(_part: string) {}
    estimatedPercentComplete() { return 0; }
    isComplete() { return false; }
    isSuccess() { return true; }
    resultRegistryType() { return null; }
  },
}));

vi.mock("../../../../../src/services/deviceParsers", () => ({
  parseDeviceJson: parseDeviceJsonMock,
}));

vi.mock("../../../../../src/services/hardwareWallet/runtime", () => ({
  hardwareWalletService: {
    connect: connectMock,
    connectWithLease: async (...args: unknown[]) => ({
      device: await connectMock(...args),
      lease: connectionLease,
    }),
    releaseConnection: disconnectMock,
    getAllXpubs: getAllXpubsMock,
    getAllXpubsWithFailures: async (callback: unknown) => {
      const value = await getAllXpubsMock(callback);
      return Array.isArray(value)
        ? { results: value, failures: [], totalPaths: value.length }
        : value;
    },
    getAllXpubsWithFailuresForLease: async (_lease: unknown, callback: unknown) => {
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

describe("useAddAccountFlow async race and cancellation guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    connectMock.mockResolvedValue({ connected: true, fingerprint: "abcd1234" });
    getAllXpubsMock.mockResolvedValue([]);
    disconnectMock.mockResolvedValue(undefined);
    getDeviceMock.mockResolvedValue({ ...defaultDevice });
    addDeviceAccountMock.mockResolvedValue(undefined);
    parseDeviceJsonMock.mockReturnValue(null);
    extractFromUrResultMock.mockReturnValue(null);
    normalizeDerivationPathMock.mockImplementation((path: string) => path);
  });

  it("ignores stale FileReader onload and onerror after method switch or reset", () => {
    const readers: Array<{
      onload: ((event: { target: { result: string } }) => void) | null;
      onerror: (() => void) | null;
      readAsText: () => void;
    }> = [];
    const OriginalFileReader = globalThis.FileReader;
    class DeferredFileReader {
      onload: ((event: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        readers.push(this);
      }
    }
    vi.stubGlobal("FileReader", DeferredFileReader);

    try {
      const { result } = renderFlowHook();
      parseDeviceJsonMock.mockReturnValue({
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

      act(() => {
        result.current.handleFileUpload({
          target: { files: [new File(["stale"], "stale.json")] },
        } as any);
      });
      act(() => {
        result.current.setAddAccountMethod("qr");
      });
      act(() => {
        readers[0].onload?.({ target: { result: "stale" } });
      });
      expect(result.current.parsedAccounts).toEqual([]);

      act(() => {
        result.current.handleFileUpload({
          target: { files: [new File(["err"], "err.json")] },
        } as any);
      });
      act(() => {
        result.current.resetImportState();
      });
      act(() => {
        readers[1].onerror?.();
      });
      expect(result.current.addAccountError).toBeNull();
    } finally {
      vi.stubGlobal("FileReader", OriginalFileReader);
    }
  });

  it("guards concurrent USB additions and cancels remaining work on unmount", async () => {
    let resolveConnect!: (value: { connected: boolean; fingerprint: string }) => void;
    connectMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );

    const { result, unmount } = renderFlowHook();

    let firstPromise!: Promise<void>;
    act(() => {
      firstPromise = result.current.handleAddAccountsViaUsb();
    });
    // Concurrent invocation while first is in flight must be ignored
    await act(async () => {
      await result.current.handleAddAccountsViaUsb();
    });
    await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1));

    // Unmount before connect resolves: must release connection and skip xpub fetch
    unmount();
    await act(async () => {
      resolveConnect({ connected: true, fingerprint: "abcd1234" });
      await firstPromise;
    });

    expect(getAllXpubsMock).not.toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalledWith(connectionLease);
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it("stops adding parsed accounts if unmounted mid-loop", async () => {
    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/12'",
          xpub: "xpub-12",
        },
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/13'",
          xpub: "xpub-13",
        },
      ],
      fingerprint: "abcd1234",
    });

    let resolveFirstAdd!: () => void;
    addDeviceAccountMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirstAdd = resolve;
      }),
    );

    const { result, unmount } = renderFlowHook();
    act(() => {
      result.current.handleQrScan([{ rawValue: "plain-two-accounts" }]);
    });
    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(2));

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleAddParsedAccounts();
    });
    // Duplicate submission while in flight is ignored
    await act(async () => {
      await result.current.handleAddParsedAccounts();
    });
    await waitFor(() => expect(addDeviceAccountMock).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      resolveFirstAdd();
      await savePromise;
    });

    expect(addDeviceAccountMock).toHaveBeenCalledTimes(1);
    expect(getDeviceMock).not.toHaveBeenCalled();
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it("cancels USB xpub progress, post-xpub resolution, USB add loop, and post-getDevice refresh on unmount", async () => {
    // 1. Progress callback throws when unmounted mid-scan (covers progress guard + catch !isCurrent)
    let triggerProgress!: () => void;
    getAllXpubsMock.mockImplementationOnce(
      (onProgress?: (c: number, t: number, n: string) => void) =>
        new Promise((resolve, reject) => {
          triggerProgress = () => {
            try {
              onProgress?.(1, 3, "Native SegWit");
              resolve([]);
            } catch (err) {
              reject(err);
            }
          };
        }),
    );
    const flow1 = renderFlowHook();
    let p1!: Promise<void>;
    act(() => { p1 = flow1.result.current.handleAddAccountsViaUsb(); });
    await waitFor(() => expect(getAllXpubsMock).toHaveBeenCalledTimes(1));
    flow1.unmount();
    await act(async () => {
      triggerProgress();
      await p1;
    });
    expect(onCloseMock).not.toHaveBeenCalled();

    // 2. Unmount while getAllXpubs promise is pending (covers post-xpub !isCurrent)
    let resolveXpubs!: (val: unknown[]) => void;
    getAllXpubsMock.mockReturnValueOnce(new Promise((resolve) => { resolveXpubs = resolve; }));
    const flow2 = renderFlowHook();
    let p2!: Promise<void>;
    act(() => { p2 = flow2.result.current.handleAddAccountsViaUsb(); });
    await waitFor(() => expect(getAllXpubsMock).toHaveBeenCalledTimes(2));
    flow2.unmount();
    await act(async () => { resolveXpubs([]); await p2; });

    // 3. Unmount mid-addDeviceAccount during USB flow (covers USB addedCount === null)
    let resolveUsbAdd!: () => void;
    getAllXpubsMock.mockResolvedValueOnce([
      {
        purpose: "single_sig",
        scriptType: "native_segwit",
        path: "m/84'/0'/19'",
        xpub: "xpub-19",
        fingerprint: "abcd1234",
      },
    ]);
    addDeviceAccountMock.mockReturnValueOnce(new Promise<void>((resolve) => { resolveUsbAdd = resolve; }));
    const flow3 = renderFlowHook();
    let p3!: Promise<void>;
    act(() => { p3 = flow3.result.current.handleAddAccountsViaUsb(); });
    await waitFor(() => expect(addDeviceAccountMock).toHaveBeenCalledTimes(1));
    flow3.unmount();
    await act(async () => { resolveUsbAdd(); await p3; });
    expect(getDeviceMock).not.toHaveBeenCalled();

    // 4. Unmount during getDevice refresh in parsed flow (both resolve and reject)
    const parsedAccount = {
      accounts: [
        {
          purpose: "single_sig",
          scriptType: "native_segwit",
          derivationPath: "m/84'/0'/20'",
          xpub: "xpub-20",
        },
      ],
      fingerprint: "abcd1234",
    };

    let resolveGetDevice!: (val: unknown) => void;
    parseDeviceJsonMock.mockReturnValueOnce(parsedAccount);
    addDeviceAccountMock.mockResolvedValueOnce(undefined);
    getDeviceMock.mockReturnValueOnce(new Promise((resolve) => { resolveGetDevice = resolve; }));
    const flow4 = renderFlowHook();
    act(() => { flow4.result.current.handleQrScan([{ rawValue: "plain-one" }]); });
    await waitFor(() => expect(flow4.result.current.parsedAccounts).toHaveLength(1));
    let p4!: Promise<void>;
    act(() => { p4 = flow4.result.current.handleAddParsedAccounts(); });
    await waitFor(() => expect(getDeviceMock).toHaveBeenCalledTimes(1));
    flow4.unmount();
    await act(async () => { resolveGetDevice({ id: "device-1" }); await p4; });
    expect(onDeviceUpdatedMock).not.toHaveBeenCalled();

    let rejectGetDevice!: (err: Error) => void;
    parseDeviceJsonMock.mockReturnValueOnce(parsedAccount);
    addDeviceAccountMock.mockResolvedValueOnce(undefined);
    getDeviceMock.mockReturnValueOnce(new Promise((_, reject) => { rejectGetDevice = reject; }));
    const flow5 = renderFlowHook();
    act(() => { flow5.result.current.handleQrScan([{ rawValue: "plain-two" }]); });
    await waitFor(() => expect(flow5.result.current.parsedAccounts).toHaveLength(1));
    let p5!: Promise<void>;
    act(() => { p5 = flow5.result.current.handleAddParsedAccounts(); });
    await waitFor(() => expect(getDeviceMock).toHaveBeenCalledTimes(2));
    flow5.unmount();
    await act(async () => { rejectGetDevice(new Error("late refresh error")); await p5; });
    expect(onCloseMock).not.toHaveBeenCalled();
  });
});
