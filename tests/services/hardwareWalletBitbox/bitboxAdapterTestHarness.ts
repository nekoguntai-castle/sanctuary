import * as bitcoin from 'bitcoinjs-lib';
import { type Mock, afterEach, beforeAll, beforeEach, vi } from 'vitest';

const bitBoxMocks = vi.hoisted(() => {
  const mockGetDevicePath = vi.fn();
  const mockGetKeypathFromString = vi.fn((path: string) =>
    path
      .replace(/^m\//, '')
      .split('/')
      .map((part: string) => parseInt(part.replace(/['h]$/, ''), 10) || 0)
  );
  const mockIsErrorAbort = vi.fn((_err?: unknown) => false);

  const mockApiConnect = vi.fn();
  const mockApiClose = vi.fn();
  const mockFirmwareProduct = vi.fn();
  const mockBtcXPub = vi.fn();
  const mockDisplayAddressSimple = vi.fn();
  const mockPsbtFromBase64 = vi.fn();
  const mockTransactionFromBuffer = vi.fn();

  const constants = {
    Product: {
      BitBox02Multi: 1,
      BitBox02BTCOnly: 2,
    },
    messages: {
      BTCScriptConfig_SimpleType: {
        P2WPKH: 10,
        P2WPKH_P2SH: 11,
        P2TR: 12,
      },
      BTCXPubType: {
        VPUB: 20,
        ZPUB: 21,
        UPUB: 22,
        YPUB: 23,
        TPUB: 24,
        XPUB: 25,
      },
      BTCCoin: {
        TBTC: 30,
        BTC: 31,
      },
      BTCOutputType: {
        P2WPKH: 40,
        P2WSH: 41,
        P2TR: 42,
        P2PKH: 43,
        P2SH: 44,
      },
    },
  };

  const MockBitBox02API = vi.fn(function MockBitBox02API(this: any) {
    this.connect = (...args: unknown[]) => mockApiConnect(...args);
    this.close = (...args: unknown[]) => mockApiClose(...args);
    this.firmware = () => ({
      Product: (...args: unknown[]) => mockFirmwareProduct(...args),
    });
    this.btcXPub = (...args: unknown[]) => mockBtcXPub(...args);
    this.btcDisplayAddressSimple = (...args: unknown[]) => mockDisplayAddressSimple(...args);
    this.btcSignSimple = vi.fn();
  });

  return {
    mockGetDevicePath,
    mockGetKeypathFromString,
    mockIsErrorAbort,
    mockApiConnect,
    mockApiClose,
    mockFirmwareProduct,
    mockBtcXPub,
    mockDisplayAddressSimple,
    constants,
    MockBitBox02API,
    mockPsbtFromBase64,
    mockTransactionFromBuffer,
  };
});

vi.mock('bitbox02-api', () => ({
  BitBox02API: bitBoxMocks.MockBitBox02API,
  getDevicePath: bitBoxMocks.mockGetDevicePath,
  getKeypathFromString: bitBoxMocks.mockGetKeypathFromString,
  constants: bitBoxMocks.constants,
  HARDENED: 0x80000000,
  isErrorAbort: bitBoxMocks.mockIsErrorAbort,
}));

vi.mock('bitcoinjs-lib', () => ({
  networks: {
    bitcoin: { pubKeyHash: 0, scriptHash: 5 },
    testnet: { pubKeyHash: 111, scriptHash: 196 },
  },
  address: {
    fromBech32: vi.fn(),
    fromBase58Check: vi.fn(),
  },
  Psbt: {
    fromBase64: (...args: unknown[]) => bitBoxMocks.mockPsbtFromBase64(...args),
  },
  Transaction: {
    SIGHASH_ALL: 1,
    fromBuffer: (...args: unknown[]) => bitBoxMocks.mockTransactionFromBuffer(...args),
  },
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../shared/utils/bitcoin', () => ({
  normalizeDerivationPath: (path: string) => path,
}));

type BitBoxAdapterConstructor = typeof import('../../../services/hardwareWallet/adapters/bitbox').BitBoxAdapter;
type BitBoxAdapterInstance = InstanceType<BitBoxAdapterConstructor>;

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

let BitBoxAdapter: BitBoxAdapterConstructor;

export const mockGetDevicePath = bitBoxMocks.mockGetDevicePath;
export const mockGetKeypathFromString = bitBoxMocks.mockGetKeypathFromString;
export const mockIsErrorAbort = bitBoxMocks.mockIsErrorAbort;
export const mockApiConnect = bitBoxMocks.mockApiConnect;
export const mockApiClose = bitBoxMocks.mockApiClose;
export const mockFirmwareProduct = bitBoxMocks.mockFirmwareProduct;
export const mockBtcXPub = bitBoxMocks.mockBtcXPub;
export const mockDisplayAddressSimple = bitBoxMocks.mockDisplayAddressSimple;
export const constants = bitBoxMocks.constants;
export const MockBitBox02API = bitBoxMocks.MockBitBox02API;
export const mockPsbtFromBase64 = bitBoxMocks.mockPsbtFromBase64;
export const mockTransactionFromBuffer = bitBoxMocks.mockTransactionFromBuffer;
export const bitcoinLib = bitcoin;

export function setupBitBoxAdapterTestHarness(): void {
  beforeAll(async () => {
    const module = await import('../../../services/hardwareWallet/adapters/bitbox');
    BitBoxAdapter = module.BitBoxAdapter;
  });

  beforeEach(() => {
    mockGetDevicePath.mockReset();
    mockGetKeypathFromString.mockReset();
    mockIsErrorAbort.mockReset();
    mockApiConnect.mockReset();
    mockApiClose.mockReset();
    mockFirmwareProduct.mockReset();
    mockBtcXPub.mockReset();
    mockDisplayAddressSimple.mockReset();
    mockPsbtFromBase64.mockReset();
    mockTransactionFromBuffer.mockReset();
    MockBitBox02API.mockClear();
    setWebHidEnv({ secure: true, withHid: true });
    setAuthorizedHidDevices([]);
    mockGetKeypathFromString.mockImplementation((path: string) =>
      path
        .replace(/^m\//, '')
        .split('/')
        .map((part: string) => parseInt(part.replace(/['h]$/, ''), 10) || 0)
    );
    mockGetDevicePath.mockResolvedValue('WEBHID');
    mockApiConnect.mockResolvedValue(undefined);
    mockApiClose.mockReturnValue(undefined);
    mockFirmwareProduct.mockReturnValue(constants.Product.BitBox02Multi);
    mockBtcXPub.mockResolvedValue('xpub-bitbox');
    mockDisplayAddressSimple.mockResolvedValue(undefined);
    mockIsErrorAbort.mockReturnValue(false);
    mockPsbtFromBase64.mockReturnValue({
      data: { globalMap: { unsignedTx: {} }, inputs: [], outputs: [] },
      txInputs: [],
      txOutputs: [],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-psbt'),
    });
    mockTransactionFromBuffer.mockReturnValue({
      outs: [{ value: 1234 }],
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  });
}

export function createBitBoxAdapter(): BitBoxAdapterInstance {
  if (!BitBoxAdapter) {
    throw new Error('BitBoxAdapter was not loaded before the test ran');
  }

  return new BitBoxAdapter();
}

export function setWebHidEnv(options: { secure?: boolean; withHid?: boolean } = {}): void {
  const { secure = true, withHid = true } = options;
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(originalWindow as object),
      isSecureContext: secure,
    },
    configurable: true,
  });

  const nav = withHid
    ? {
      hid: {
        getDevices: vi.fn(),
      },
    }
    : {};

  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
  });
}

export function setAuthorizedHidDevices(devices: unknown[]): void {
  (globalThis.navigator as any).hid.getDevices.mockResolvedValue(devices);
}

export function makeHidDevice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vendorId: 0x03eb,
    productId: 0x2403,
    opened: false,
    productName: 'BitBox02',
    ...overrides,
  };
}

export function seedConnectedAdapter(adapter: BitBoxAdapterInstance): void {
  (adapter as any).connection = {
    api: {
      btcXPub: (...args: unknown[]) => mockBtcXPub(...args),
      btcDisplayAddressSimple: (...args: unknown[]) => mockDisplayAddressSimple(...args),
    },
    devicePath: 'WEBHID',
    product: constants.Product.BitBox02Multi,
  };
  (adapter as any).connectedDevice = {
    id: 'bitbox-1',
    type: 'bitbox',
    name: 'BitBox',
    model: 'BitBox02',
    connected: true,
    fingerprint: undefined,
  };
}

export function seedSigningAdapter(
  adapter: BitBoxAdapterInstance,
  btcSignSimple: Mock<(...args: unknown[]) => unknown>
): void {
  (adapter as any).connection = {
    api: { btcSignSimple: (...args: unknown[]) => btcSignSimple(...args) },
    devicePath: 'WEBHID',
    product: constants.Product.BitBox02Multi,
  };
}
