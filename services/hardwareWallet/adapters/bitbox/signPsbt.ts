/**
 * BitBox02 PSBT Signing
 *
 * Standalone function for signing PSBTs with a BitBox02 device.
 * Receives the connection and request as parameters.
 */

import { getKeypathFromString } from 'bitbox02-api';
import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../../utils/logger';
import { isTestnetPath } from '../../pathUtils';
import { getSimpleType, getCoin, getOutputType, extractAccountPath } from './pathUtils';
import type { BitBoxConnection } from './types';
import type { PSBTSignRequest, PSBTSignResponse } from '../../types';

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

const DEFAULT_ACCOUNT_PATH = "m/84'/0'/0'";

const getAccountPathFromPsbt = (psbt: BitBoxPsbt): string | undefined => {
  for (const input of psbt.data.inputs) {
    const derivation = input.bip32Derivation?.[0];
    if (derivation) {
      return extractAccountPath(derivation.path);
    }
  }

  return undefined;
};

const getAccountPath = (request: PSBTSignRequest, psbt: BitBoxPsbt): string => {
  if (request.accountPath) {
    return request.accountPath;
  }

  if (request.inputPaths && request.inputPaths.length > 0) {
    return extractAccountPath(request.inputPaths[0]);
  }

  return getAccountPathFromPsbt(psbt) || DEFAULT_ACCOUNT_PATH;
};

const getInputValue = (input: BitBoxInputData, txInput: BitBoxTxInput): bigint => {
  if (input.witnessUtxo) {
    return BigInt(input.witnessUtxo.value);
  }

  if (input.nonWitnessUtxo) {
    const prevTx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
    return BigInt(prevTx.outs[txInput.index].value);
  }

  return 0n;
};

const getInputKeypath = (
  input: BitBoxInputData,
  request: PSBTSignRequest,
  inputIndex: number,
  keypathAccount: number[]
): number[] => {
  const derivationPath = input.bip32Derivation?.[0]?.path || request.inputPaths?.[inputIndex];
  return derivationPath ? getKeypathFromString(derivationPath) : [...keypathAccount, 0, 0];
};

const buildBitBoxInput = (
  input: BitBoxInputData,
  txInput: BitBoxTxInput,
  request: PSBTSignRequest,
  inputIndex: number,
  keypathAccount: number[]
): BitBoxSigningInput => {
  return {
    prevOutHash: new Uint8Array(txInput.hash),
    prevOutIndex: txInput.index,
    prevOutValue: getInputValue(input, txInput).toString(),
    sequence: txInput.sequence ?? 0xffffffff,
    keypath: getInputKeypath(input, request, inputIndex, keypathAccount),
  };
};

const buildBitBoxInputs = (
  psbt: BitBoxPsbt,
  request: PSBTSignRequest,
  keypathAccount: number[]
): BitBoxSigningInput[] => {
  return psbt.data.inputs.map((input, index) =>
    buildBitBoxInput(input, psbt.txInputs[index], request, index, keypathAccount)
  );
};

const isChangeOutput = (outputData: BitBoxOutputData | undefined, accountPath: string): boolean => {
  const derivationPath = outputData?.bip32Derivation?.[0]?.path;
  return Boolean(derivationPath?.startsWith(accountPath.replace("m/", "")));
};

const decodeAddressPayload = (address: string): Uint8Array => {
  try {
    if (address.startsWith('bc1') || address.startsWith('tb1')) {
      const decoded = bitcoin.address.fromBech32(address);
      return new Uint8Array(decoded.data);
    }

    const decoded = bitcoin.address.fromBase58Check(address);
    return new Uint8Array(decoded.hash);
  } catch (e) {
    log.warn('Could not decode address', { address, error: e });
    return new Uint8Array(0);
  }
};

const buildChangeOutput = (outputData: BitBoxOutputData, value: string): BitBoxSigningOutput => {
  return {
    ours: true,
    keypath: getKeypathFromString(outputData.bip32Derivation![0].path),
    value,
  };
};

const buildExternalOutput = (
  output: BitBoxTxOutput,
  value: string,
  network: bitcoin.Network
): BitBoxSigningOutput => {
  const address = output.address || '';

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
  network: bitcoin.Network
): BitBoxSigningOutput => {
  const value = BigInt(output.value).toString();
  return isChangeOutput(outputData, accountPath) && outputData?.bip32Derivation
    ? buildChangeOutput(outputData, value)
    : buildExternalOutput(output, value, network);
};

const buildBitBoxOutputs = (
  psbt: BitBoxPsbt,
  accountPath: string,
  network: bitcoin.Network
): BitBoxSigningOutput[] => {
  return psbt.txOutputs.map((output, index) =>
    buildBitBoxOutput(output, psbt.data.outputs[index], accountPath, network)
  );
};

const applyBitBoxSignatures = (psbt: BitBoxPsbt, signatures: Uint8Array[]): void => {
  for (let i = 0; i < signatures.length; i++) {
    const input = psbt.data.inputs[i];
    const pubkey = input.bip32Derivation?.[0]?.pubkey;
    if (!pubkey) {
      continue;
    }

    // BitBox02 returns 64-byte signatures (r || s), need to add sighash byte.
    const sighashType = input.sighashType || bitcoin.Transaction.SIGHASH_ALL;
    const fullSig = Buffer.concat([
      Buffer.from(signatures[i]),
      Buffer.from([sighashType]),
    ]);

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
  // Parse PSBT
  const psbt = bitcoin.Psbt.fromBase64(request.psbt);

  const accountPath = getAccountPath(request, psbt);
  log.info('Using account path', { accountPath });

  const coin = getCoin(accountPath);
  const simpleType = getSimpleType(request.scriptType, accountPath);
  const keypathAccount = getKeypathFromString(accountPath);

  // Determine network
  const isTestnet = isTestnetPath(accountPath);
  const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

  const inputs = buildBitBoxInputs(psbt, request, keypathAccount);
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
