/**
 * BitBox02 PSBT Signing
 *
 * Standalone function for signing PSBTs with a BitBox02 device.
 * Receives the connection and request as parameters.
 */

import { getKeypathFromString, isErrorAbort } from 'bitbox02-api';
import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../../utils/logger';
import { getSimpleType, getCoin, getOutputType, extractAccountPath } from './pathUtils';
import type { BitBoxConnection } from './types';
import type { PSBTSignRequest, PSBTSignResponse } from '../../types';

const log = createLogger('BitBoxAdapter');

/**
 * Sign a PSBT with a BitBox02 device
 */
export async function signPsbtWithBitBox(
  request: PSBTSignRequest,
  connection: BitBoxConnection
): Promise<PSBTSignResponse> {
  // Parse PSBT
  const psbt = bitcoin.Psbt.fromBase64(request.psbt);

  // Determine account path from request or PSBT
  let accountPath = request.accountPath;
  if (!accountPath && request.inputPaths && request.inputPaths.length > 0) {
    accountPath = extractAccountPath(request.inputPaths[0]);
  }
  if (!accountPath) {
    // Try to extract from PSBT bip32Derivation
    for (const input of psbt.data.inputs) {
      if (input.bip32Derivation && input.bip32Derivation.length > 0) {
        accountPath = extractAccountPath(input.bip32Derivation[0].path);
        break;
      }
    }
  }
  if (!accountPath) {
    accountPath = "m/84'/0'/0'";
  }

  log.info('Using account path', { accountPath });

  const coin = getCoin(accountPath);
  const simpleType = getSimpleType(request.scriptType, accountPath);
  const keypathAccount = getKeypathFromString(accountPath);

  // Determine network
  const isTestnet = accountPath.includes("/1'") || accountPath.includes("/1h");
  const network = isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

  // Build inputs array for BitBox02
  const inputs: Array<{
    prevOutHash: Uint8Array;
    prevOutIndex: number;
    prevOutValue: string;
    sequence: number;
    keypath: number[];
  }> = [];

  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const input = psbt.data.inputs[i];
    const txInput = psbt.txInputs[i];

    // Get value from witnessUtxo or nonWitnessUtxo
    let value: bigint | number = 0n;
    if (input.witnessUtxo) {
      value = BigInt(input.witnessUtxo.value);
    } else if (input.nonWitnessUtxo && txInput) {
      const prevTx = bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo);
      value = BigInt(prevTx.outs[txInput.index].value);
    }

    // Get keypath from bip32Derivation or inputPaths
    let keypath: number[] = [];
    if (input.bip32Derivation && input.bip32Derivation.length > 0) {
      keypath = getKeypathFromString(input.bip32Derivation[0].path);
    } else if (request.inputPaths && request.inputPaths[i]) {
      keypath = getKeypathFromString(request.inputPaths[i]);
    } else {
      // Default to first address of account
      keypath = [...keypathAccount, 0, 0];
    }

    inputs.push({
      prevOutHash: new Uint8Array(txInput.hash),
      prevOutIndex: txInput.index,
      prevOutValue: value.toString(),
      sequence: txInput.sequence,
      keypath,
    });
  }

  // Build outputs array for BitBox02
  const outputs: Array<{
    ours: boolean;
    type?: number;
    payload?: Uint8Array;
    keypath?: number[];
    value: string;
  }> = [];

  for (let i = 0; i < psbt.txOutputs.length; i++) {
    const output = psbt.txOutputs[i];
    const outputData = psbt.data.outputs[i];
    const value = BigInt(output.value).toString();

    // Check if this is a change output (has bip32Derivation with our account path)
    const isChange =
      outputData?.bip32Derivation &&
      outputData.bip32Derivation.length > 0 &&
      outputData.bip32Derivation[0].path.startsWith(accountPath.replace("m/", ""));

    if (isChange && outputData?.bip32Derivation) {
      // Change output
      outputs.push({
        ours: true,
        keypath: getKeypathFromString(outputData.bip32Derivation[0].path),
        value,
      });
    } else {
      // External output
      const address = output.address || '';
      const outputType = getOutputType(address, network);

      // Get payload (hash) from address
      let payload = new Uint8Array(0);
      try {
        if (address.startsWith('bc1') || address.startsWith('tb1')) {
          const decoded = bitcoin.address.fromBech32(address);
          payload = new Uint8Array(decoded.data);
        } else {
          const decoded = bitcoin.address.fromBase58Check(address);
          payload = new Uint8Array(decoded.hash);
        }
      } catch (e) {
        log.warn('Could not decode address', { address, error: e });
      }

      outputs.push({
        ours: false,
        type: outputType,
        payload,
        value,
      });
    }
  }

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

  // Apply signatures to PSBT
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    const input = psbt.data.inputs[i];

    if (input.bip32Derivation && input.bip32Derivation.length > 0) {
      const pubkey = input.bip32Derivation[0].pubkey;

      // BitBox02 returns 64-byte signatures (r || s), need to add sighash byte
      const sighashType = input.sighashType || bitcoin.Transaction.SIGHASH_ALL;
      const fullSig = Buffer.concat([
        Buffer.from(sig),
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
  }

  // Finalize
  psbt.finalizeAllInputs();

  log.info('PSBT signed and finalized successfully', { signatureCount: signatures.length });

  return {
    psbt: psbt.toBase64(),
    signatures: signatures.length,
  };
}
