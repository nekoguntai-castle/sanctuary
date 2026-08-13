/**
 * BitBox02 PSBT Signing
 *
 * Standalone function for signing PSBTs with a BitBox02 device.
 * Receives the connection and request as parameters.
 */

import { getKeypathFromString } from 'bitbox02-api';
import * as bitcoin from 'bitcoinjs-lib';
import { normalizeDerivationPath, parseAddressDerivationPath, parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import { createLogger } from '../../../../utils/logger';
import { isTestnetPath } from '../../pathUtils';
import { getSimpleType, getCoin, getOutputType, extractAccountPath } from './pathUtils';
import type { BitBoxConnection } from './types';
import type { PSBTSignRequest, PSBTSignResponse } from '../../types';
import {
  getUnsupportedMultisigHardwareSigningMessage,
  isMultisigSigningRequest,
} from '../../signingSupport';

const log = createLogger('BitBoxAdapter');

type BitBoxPsbt = ReturnType<typeof bitcoin.Psbt.fromBase64>;
type BitBoxInputData = BitBoxPsbt['data']['inputs'][number];
type BitBoxOutputData = BitBoxPsbt['data']['outputs'][number];
type BitBoxTxInput = BitBoxPsbt['txInputs'][number];
type BitBoxTxOutput = BitBoxPsbt['txOutputs'][number];

type BitBoxSigningInput = {
  prevOutHash: Uint8Array;
  prevOutIndex: number;
  prevOutValue: string;
  sequence: number;
  keypath: number[];
};

type BitBoxSigningOutput = {
  ours: boolean;
  type?: number;
  payload?: Uint8Array;
  keypath?: number[];
  value: string;
};

const getAccountPathFromPsbt = (psbt: BitBoxPsbt): string | undefined => {
  for (const input of psbt.data.inputs) {
    const derivation = input.bip32Derivation?.[0];
    if (derivation) {
      return extractAccountPath(derivation.path);
    }
  }

  return undefined;
};

const getAccountPathBeforeParsing = (request: PSBTSignRequest): string => {
  const paths = [
    request.accountPath,
    ...(request.inputPaths ?? []).map(extractAccountPath),
    ...(request.signingContext?.signers.map((signer) => signer.accountPath) ?? []),
  ].filter((path): path is string => Boolean(path));
  if (paths.length === 0) {
    throw new Error('BitBox02 account path is required before PSBT parsing');
  }
  const normalized = paths.map(normalizeDerivationPath);
  if (new Set(normalized).size !== 1) {
    throw new Error('BitBox02 pre-parse account path evidence disagrees');
  }
  const parsed = parseDerivationPath(normalized[0]);
  if (!parsed.valid || parsed.accountPath !== normalized[0]) {
    throw new Error('BitBox02 pre-parse account path is not exact');
  }
  return normalized[0];
};

const getAccountPath = (request: PSBTSignRequest, psbt: BitBoxPsbt): string => {
  const paths = [
    request.accountPath,
    ...(request.inputPaths ?? []).map(extractAccountPath),
    getAccountPathFromPsbt(psbt),
  ].filter((path): path is string => Boolean(path));
  if (paths.length === 0) throw new Error('BitBox02 account path is missing');
  const normalized = paths.map(normalizeDerivationPath);
  if (new Set(normalized).size !== 1) throw new Error('BitBox02 account path evidence disagrees');
  const parsed = parseDerivationPath(normalized[0]);
  if (!parsed.valid || parsed.accountPath !== normalized[0]) {
    throw new Error('BitBox02 account path is not an exact account path');
  }
  return normalized[0];
};

const getInputValue = (input: BitBoxInputData, index: number): bigint => {
  if (input.witnessUtxo) {
    const value = BigInt(input.witnessUtxo.value);
    if (value < 0n) throw new Error(`BitBox02 input ${index} prevout value is negative`);
    return value;
  }

  if (input.nonWitnessUtxo) {
    throw new Error(`BitBox02 input ${index} non-witness prevout proof is unsupported`);
  }

  throw new Error(`BitBox02 input ${index} is missing prevout value evidence`);
};

const getInputKeypath = (
  input: BitBoxInputData,
  request: PSBTSignRequest,
  inputIndex: number,
  accountPath: string
): number[] => {
  const derivations = input.bip32Derivation ?? [];
  if (derivations.length !== 1) {
    throw new Error(`BitBox02 input ${inputIndex} is missing exactly one BIP32 keypath`);
  }
  const parsed = parseAddressDerivationPath(derivations[0].path);
  if (!parsed || parsed.accountPath !== accountPath) {
    throw new Error(`BitBox02 input ${inputIndex} keypath is outside the selected account`);
  }
  const hint = request.inputPaths?.[inputIndex];
  if (hint && normalizeDerivationPath(hint) !== parsed.normalizedPath) {
    throw new Error(`BitBox02 input ${inputIndex} request keypath disagrees with the PSBT`);
  }
  return getKeypathFromString(parsed.normalizedPath);
};

const buildBitBoxInput = (
  input: BitBoxInputData,
  txInput: BitBoxTxInput,
  request: PSBTSignRequest,
  inputIndex: number,
  accountPath: string
): BitBoxSigningInput => {
  if (!txInput) throw new Error(`BitBox02 input ${inputIndex} has no unsigned transaction input`);
  return {
    prevOutHash: new Uint8Array(txInput.hash),
    prevOutIndex: txInput.index,
    prevOutValue: getInputValue(input, inputIndex).toString(),
    sequence: txInput.sequence ?? 0xffffffff,
    keypath: getInputKeypath(input, request, inputIndex, accountPath),
  };
};

const buildBitBoxInputs = (
  psbt: BitBoxPsbt,
  request: PSBTSignRequest,
  accountPath: string
): BitBoxSigningInput[] => {
  return psbt.data.inputs.map((input, index) =>
    buildBitBoxInput(input, psbt.txInputs[index], request, index, accountPath)
  );
};

const isChangeOutput = (outputData: BitBoxOutputData | undefined, accountPath: string, index: number): boolean => {
  const derivations = outputData?.bip32Derivation ?? [];
  if (derivations.length === 0) return false;
  if (derivations.length !== 1) throw new Error(`BitBox02 output ${index} has ambiguous BIP32 derivations`);
  const parsed = parseAddressDerivationPath(derivations[0].path);
  if (!parsed || parsed.accountPath !== accountPath || parsed.chain !== 'change') {
    throw new Error(`BitBox02 output ${index} derivation is not an exact change path`);
  }
  throw new Error(`BitBox02 change output ${index} is blocked until exact script proof is implemented`);
};

const decodeAddressPayload = (address: string): Uint8Array => {
  if (/^(?:bc1|tb1)/i.test(address)) {
    return new Uint8Array(bitcoin.address.fromBech32(address).data);
  }
  return new Uint8Array(bitcoin.address.fromBase58Check(address).hash);
};

const buildExternalOutput = (
  output: BitBoxTxOutput,
  value: string,
  network: bitcoin.Network,
  index: number
): BitBoxSigningOutput => {
  const address = output.address;
  if (!address) throw new Error(`BitBox02 external output ${index} has no address`);

  return {
    ours: false,
    type: getOutputType(address, network),
    payload: decodeAddressPayload(address),
    value,
  };
};

const buildBitBoxOutput = (
  output: BitBoxTxOutput,
  outputData: BitBoxOutputData | undefined,
  accountPath: string,
  network: bitcoin.Network,
  index: number
): BitBoxSigningOutput => {
  const value = BigInt(output.value).toString();
  isChangeOutput(outputData, accountPath, index);
  return buildExternalOutput(output, value, network, index);
};

const buildBitBoxOutputs = (
  psbt: BitBoxPsbt,
  accountPath: string,
  network: bitcoin.Network
): BitBoxSigningOutput[] => {
  return psbt.txOutputs.map((output, index) =>
    buildBitBoxOutput(output, psbt.data.outputs[index], accountPath, network, index)
  );
};

const applyBitBoxSignatures = (psbt: BitBoxPsbt, signatures: Uint8Array[]): void => {
  if (signatures.length !== psbt.data.inputs.length) {
    throw new Error(`BitBox02 returned ${signatures.length} signatures for ${psbt.data.inputs.length} inputs`);
  }
  for (let i = 0; i < signatures.length; i++) {
    const input = psbt.data.inputs[i];
    const pubkey = input.bip32Derivation?.[0]?.pubkey;
    if (!pubkey || input.bip32Derivation?.length !== 1) {
      throw new Error(`BitBox02 signature ${i} has no unambiguous input public key`);
    }
    if (signatures[i].length !== 64) throw new Error(`BitBox02 signature ${i} must be exactly 64 bytes`);

    // BitBox02 returns compact r||s; PSBT partialSig requires canonical DER
    // followed by the sighash byte.
    const sighashType = input.sighashType ?? bitcoin.Transaction.SIGHASH_ALL;
    if (!Number.isInteger(sighashType) || sighashType < 0 || sighashType > 0xff) {
      throw new Error(`BitBox02 input ${i} has an unsupported sighash type`);
    }
    const fullSig = bitcoin.script.signature.encode(signatures[i], sighashType);

    psbt.updateInput(i, {
      partialSig: [
        {
          pubkey,
          signature: fullSig,
        },
      ],
    });
  }
};

/**
 * Sign a PSBT with a BitBox02 device
 */
export const signPsbtWithBitBox = async (
  request: PSBTSignRequest,
  connection: BitBoxConnection
): Promise<PSBTSignResponse> => {
  const preParseAccountPath = getAccountPathBeforeParsing(request);
  const network = isTestnetPath(preParseAccountPath)
    ? bitcoin.networks.testnet
    : bitcoin.networks.bitcoin;
  const psbt = bitcoin.Psbt.fromBase64(request.psbt, { network });

  if (isMultisigSigningRequest(request, psbt)) {
    throw new Error(getUnsupportedMultisigHardwareSigningMessage('BitBox02'));
  }

  const accountPath = getAccountPath(request, psbt);
  if (accountPath !== preParseAccountPath) {
    throw new Error('BitBox02 parsed PSBT account path disagrees with pre-parse evidence');
  }
  log.info('Using account path', { accountPath });

  const coin = getCoin(accountPath);
  const simpleType = getSimpleType(request.scriptType, accountPath);
  if (parseDerivationPath(accountPath).scriptType === 'taproot') {
    throw new Error('BitBox02 Taproot signing is blocked until Schnorr signature mapping is proven');
  }
  const keypathAccount = getKeypathFromString(accountPath);

  const inputs = buildBitBoxInputs(psbt, request, accountPath);
  const outputs = buildBitBoxOutputs(psbt, accountPath, network);

  log.info('Calling btcSignSimple', {
    coin,
    simpleType,
    inputCount: inputs.length,
    outputCount: outputs.length,
  });

  // Get transaction version and locktime
  const version = psbt.version;
  const locktime = psbt.locktime;

  // Sign the transaction
  const signatures = await connection.api.btcSignSimple(
    coin,
    simpleType,
    keypathAccount,
    inputs,
    outputs,
    version,
    locktime
  );

  log.info('Got signatures from device', { signatureCount: signatures.length });

  applyBitBoxSignatures(psbt, signatures);

  // Finalize
  psbt.finalizeAllInputs();

  log.info('PSBT signed and finalized successfully', { signatureCount: signatures.length });

  return {
    psbt: psbt.toBase64(),
    signatures: signatures.length,
  };
};
