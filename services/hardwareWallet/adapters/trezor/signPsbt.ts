/**
 * PSBT Signing
 *
 * Standalone function for signing PSBTs with Trezor.
 * Receives connection state as a parameter instead of using `this`.
 */

import TrezorConnect from '@trezor/connect-web';
import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../../utils/logger';
import type { PSBTSignRequest, PSBTSignResponse } from '../../types';
import type { TrezorConnection } from './types';
import { isMultisigInput } from './multisig';
import { fetchRefTxs } from './refTxs';
import {
  detectNetwork,
  getDeviceFingerprintBuffer,
  getRequestScriptType,
  verifyDeviceIsCosigner,
} from './signPsbtNetwork';
import { buildTrezorInputs, buildTrezorOutputs } from './signPsbtPayloads';
import { applyTrezorMultisigSignatures } from './signPsbtSignatures';
import {
  getSerializedTrezorTx,
  getUnsignedTransactionFromPsbt,
  logRefTxAmountMismatches,
  logSignedTxMismatches,
} from './signPsbtValidation';
import { mapTrezorSigningError } from './signPsbtErrors';

const log = createLogger('TrezorAdapter');

/**
 * Sign a PSBT with Trezor.
 * Note: Trezor returns a fully signed raw transaction, not a PSBT.
 */
export const signPsbtWithTrezor = async (
  request: PSBTSignRequest,
  connection: TrezorConnection
): Promise<PSBTSignResponse> => {
  log.info('Trezor signPSBT called', {
    psbtLength: request.psbt.length,
    inputPathsCount: request.inputPaths?.length || 0,
  });

  try {
    const psbt = bitcoin.Psbt.fromBase64(request.psbt);
    const scriptType = getRequestScriptType(request);
    const network = detectNetwork(request, psbt);
    log.info('Using coin type for signing', {
      coin: network.coin,
      isTestnet: network.isTestnet,
      networkSource: network.networkSource,
      pathToCheck: network.pathToCheck || '(empty)',
    });

    const deviceFingerprint = connection.fingerprint;
    const deviceFingerprintBuffer = getDeviceFingerprintBuffer(connection);
    verifyDeviceIsCosigner(psbt, deviceFingerprint, deviceFingerprintBuffer);

    const inputs = buildTrezorInputs(
      psbt,
      request,
      scriptType,
      deviceFingerprintBuffer,
      deviceFingerprint
    );
    const isMultisig = psbt.data.inputs.some(input => isMultisigInput(input));
    const outputs = buildTrezorOutputs(
      psbt,
      request,
      scriptType,
      network.isTestnet,
      deviceFingerprintBuffer,
      deviceFingerprint
    );

    const refTxs = await fetchRefTxs(psbt);
    logRefTxAmountMismatches(psbt, refTxs);
    const txFromPsbt = getUnsignedTransactionFromPsbt(psbt);

    // Pass version and locktime from PSBT so Trezor signs the same transaction.
    const result = await TrezorConnect.signTransaction({
      inputs,
      outputs,
      refTxs: refTxs.length > 0 ? refTxs : undefined,
      coin: network.coin,
      push: false,
      version: txFromPsbt.version,
      locktime: txFromPsbt.locktime,
    });

    const signedTxHex = getSerializedTrezorTx(result);
    if (signedTxHex) {
      logSignedTxMismatches(txFromPsbt, signedTxHex);
    }

    if (isMultisig && signedTxHex) {
      applyTrezorMultisigSignatures(psbt, signedTxHex, deviceFingerprintBuffer);
    }

    return {
      psbt: psbt.toBase64(),
      rawTx: signedTxHex,
      signatures: inputs.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Trezor signing failed', { error: message });
    throw new Error(mapTrezorSigningError(message));
  }
};
