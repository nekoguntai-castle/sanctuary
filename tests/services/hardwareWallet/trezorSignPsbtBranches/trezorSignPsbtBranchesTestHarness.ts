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
  mockLoggerError,
  mockLoggerWarn,
} = trezorSignPsbtBranchMocks;

vi.mock('@trezor/connect-web', () => ({
  default: {
    signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
  },
}));

vi.mock('../../../../services/hardwareWallet/adapters/trezor/pathUtils', () => ({
  getTrezorScriptType: (...args: unknown[]) => mockGetTrezorScriptType(...args),
  pathToAddressN: (...args: unknown[]) => mockPathToAddressN(...args),
  validateSatoshiAmount: (...args: unknown[]) => mockValidateSatoshiAmount(...args),
}));

vi.mock('../../../../services/hardwareWallet/adapters/trezor/multisig', () => ({
  buildTrezorMultisig: (...args: unknown[]) => mockBuildTrezorMultisig(...args),
  isMultisigInput: (...args: unknown[]) => mockIsMultisigInput(...args),
}));

vi.mock('../../../../services/hardwareWallet/adapters/trezor/refTxs', () => ({
  fetchRefTxs: (...args: unknown[]) => mockFetchRefTxs(...args),
}));

vi.mock('../../../../utils/logger', () => ({
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

  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
  const signedTxHex = bitcoin.Transaction.fromBuffer(unsignedTx.toBuffer()).toHex();
  return { psbt, signedTxHex };
}

export function txFromPsbt(psbt: bitcoin.Psbt) {
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
  return bitcoin.Transaction.fromBuffer(unsignedTx.toBuffer());
}

export function registerTrezorSignPsbtBranchSetup() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathToAddressN.mockReturnValue([1, 2, 3]);
    mockValidateSatoshiAmount.mockImplementation((amount: number | bigint) => String(amount));
    mockGetTrezorScriptType.mockReturnValue('SPENDWITNESS');
    mockBuildTrezorMultisig.mockReturnValue(undefined);
    mockIsMultisigInput.mockReturnValue(false);
    mockFetchRefTxs.mockResolvedValue([]);
  });
}
