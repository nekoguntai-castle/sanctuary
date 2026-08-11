import * as bitcoin from 'bitcoinjs-lib';
import { beforeEach, vi } from 'vitest';

const trezorSignPsbtBranchMocks = vi.hoisted(() => ({
  mockSignTransaction: vi.fn(),
  mockGetTrezorScriptType: vi.fn(),
  mockPathToAddressN: vi.fn(),
  mockValidateSatoshiAmount: vi.fn(),
  mockBuildTrezorMultisig: vi.fn(),
  mockIsMultisigInput: vi.fn(),
  mockFetchRefTxs: vi.fn(),
  mockValidatePsbtSigningRequest: vi.fn(),
  mockValidateAndApplyTrezorSignatures: vi.fn(),
  mockAssertAuthenticatedTrezorArtifact: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

export const {
  mockSignTransaction,
  mockGetTrezorScriptType,
  mockPathToAddressN,
  mockValidateSatoshiAmount,
  mockBuildTrezorMultisig,
  mockIsMultisigInput,
  mockFetchRefTxs,
  mockValidatePsbtSigningRequest,
  mockValidateAndApplyTrezorSignatures,
  mockAssertAuthenticatedTrezorArtifact,
  mockLoggerError,
  mockLoggerWarn,
} = trezorSignPsbtBranchMocks;

export const TEST_SESSION = {
  path: 'webusb:test-device',
  state: 'test-seed@test-device:0',
  instance: 0,
} as const;

vi.mock('@trezor/connect-web', () => ({
  asDeviceUniquePath: (path: string) => path,
  default: {
    signTransaction: async (...args: unknown[]) => {
      const result = await mockSignTransaction(...args);
      return result?.success && !Object.hasOwn(result, 'device')
        ? { ...result, device: (args[0] as { device?: unknown })?.device }
        : result;
    },
  },
}));

vi.mock('../../../../src/services/hardwareWallet/adapters/trezor/pathUtils', () => ({
  getTrezorScriptType: (...args: unknown[]) => mockGetTrezorScriptType(...args),
  pathToAddressN: (...args: unknown[]) => mockPathToAddressN(...args),
  validateSatoshiAmount: (...args: unknown[]) => mockValidateSatoshiAmount(...args),
}));

vi.mock('../../../../src/services/hardwareWallet/adapters/trezor/multisig', () => ({
  buildTrezorMultisig: (...args: unknown[]) => mockBuildTrezorMultisig(...args),
  isMultisigInput: (...args: unknown[]) => mockIsMultisigInput(...args),
}));

vi.mock('../../../../src/services/hardwareWallet/adapters/trezor/refTxs', () => ({
  fetchRefTxs: (...args: unknown[]) => mockFetchRefTxs(...args),
}));

vi.mock('../../../../src/services/hardwareWallet/psbtAccountBinding', () => ({
  validatePsbtSigningRequest: (...args: unknown[]) => mockValidatePsbtSigningRequest(...args),
}));

vi.mock('../../../../src/services/hardwareWallet/adapters/trezor/signPsbtSignatures', () => ({
  validateAndApplyTrezorSignatures: (...args: unknown[]) =>
    mockValidateAndApplyTrezorSignatures(...args),
}));

vi.mock(
  '../../../../src/services/hardwareWallet/adapters/trezor/signPsbtValidation',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/services/hardwareWallet/adapters/trezor/signPsbtValidation')
      >();
    return {
      ...actual,
      assertAuthenticatedTrezorArtifact: (...args: unknown[]) =>
        mockAssertAuthenticatedTrezorArtifact(...args),
    };
  }
);

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  }),
}));

/** Convert hex to Uint8Array (bitcoinjs-lib v7 requires Uint8Array, not Buffer, in jsdom) */
export function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export function createPsbt({
  includeInputDerivation = true,
  includeWitnessUtxo = true,
  includeChangeDerivation = true,
}: {
  includeInputDerivation?: boolean;
  includeWitnessUtxo?: boolean;
  includeChangeDerivation?: boolean;
} = {}) {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  const inputPubkey = hexToBytes(`02${'11'.repeat(32)}`);
  const inputScript = hexToBytes(`0014${'11'.repeat(20)}`);

  const input: any = {
    hash: 'aa'.repeat(32),
    index: 0,
    sequence: 0xfffffffd,
  };

  if (includeWitnessUtxo) {
    input.witnessUtxo = {
      script: inputScript,
      value: BigInt(50_000),
    };
  }

  if (includeInputDerivation) {
    input.bip32Derivation = [
      {
        masterFingerprint: hexToBytes('deadbeef'),
        path: "m/49'/0'/0'/0/0",
        pubkey: inputPubkey,
      },
    ];
  }

  psbt.addInput(input);

  psbt.addOutput({
    script: hexToBytes(`0014${'22'.repeat(20)}`),
    value: BigInt(40_000),
  });

  const changeOutput: any = {
    script: hexToBytes(`0014${'33'.repeat(20)}`),
    value: BigInt(9_000),
  };
  if (includeChangeDerivation) {
    changeOutput.bip32Derivation = [
      {
        masterFingerprint: hexToBytes('deadbeef'),
        path: "m/49'/0'/0'/1/0",
        pubkey: inputPubkey,
      },
    ];
  }
  psbt.addOutput(changeOutput);

  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as {
    toBuffer(): Buffer;
  };
  const signedTxHex = bitcoin.Transaction.fromBuffer(unsignedTx.toBuffer()).toHex();
  return { psbt, signedTxHex };
}

export function txFromPsbt(psbt: bitcoin.Psbt) {
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as {
    toBuffer(): Buffer;
  };
  return bitcoin.Transaction.fromBuffer(unsignedTx.toBuffer());
}

function normalizePath(path: string): string {
  return path.replace(/h/g, "'");
}

function accountPathFromAddressPath(path: string): string {
  return normalizePath(path).split('/').slice(0, -2).join('/');
}

function firstMatchingPath(
  psbt: bitcoin.Psbt,
  fingerprint: string | undefined
): string | undefined {
  const normalizedFingerprint = fingerprint?.toLowerCase();
  for (const input of psbt.data.inputs) {
    const derivation = input.bip32Derivation?.find(
      (candidate) =>
        !normalizedFingerprint ||
        Buffer.from(candidate.masterFingerprint).toString('hex') === normalizedFingerprint
    );
    if (derivation) return derivation.path;
  }
  return undefined;
}

function validatedRequest(
  request: {
    psbt: string;
    walletId?: string;
    accountPath?: string;
    inputPaths?: string[];
  },
  fingerprint: string | undefined
) {
  const psbt = bitcoin.Psbt.fromBase64(request.psbt);
  const addressPath =
    firstMatchingPath(psbt, fingerprint) ??
    request.inputPaths?.[0] ??
    request.accountPath ??
    "m/84'/0'/0'/0/0";
  const accountPath = request.accountPath
    ? normalizePath(request.accountPath)
    : accountPathFromAddressPath(addressPath);
  const network = /\/1['h]\//.test(addressPath) ? 'testnet' : 'mainnet';
  const changeOutputs = psbt.data.outputs.flatMap((output, outputIndex) =>
    output.bip32Derivation?.length || output.tapBip32Derivation?.length ? [{ outputIndex }] : []
  );
  return {
    psbt,
    context: {
      walletId: request.walletId ?? 'wallet-test',
      inputs: psbt.txInputs.map((_, inputIndex) => ({ inputIndex })),
      changeOutputs,
    },
    connectedSigner: {
      accountPath,
      masterFingerprint: fingerprint ?? 'deadbeef',
    },
    network,
    accountPath,
    changeOutputIndexes: changeOutputs.map((binding) => binding.outputIndex),
  };
}

export function registerTrezorSignPsbtBranchSetup() {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPathToAddressN.mockReturnValue([1, 2, 3]);
    mockValidateSatoshiAmount.mockImplementation((amount: number | bigint) => String(amount));
    mockGetTrezorScriptType.mockReturnValue('SPENDWITNESS');
    mockBuildTrezorMultisig.mockReturnValue(undefined);
    mockIsMultisigInput.mockReturnValue(false);
    mockFetchRefTxs.mockResolvedValue([]);
    mockValidatePsbtSigningRequest.mockImplementation(validatedRequest);
    mockValidateAndApplyTrezorSignatures.mockImplementation((psbt: bitcoin.Psbt) => ({
      validatedPsbt: psbt,
      addedSignatures: 1,
    }));
  });
}
