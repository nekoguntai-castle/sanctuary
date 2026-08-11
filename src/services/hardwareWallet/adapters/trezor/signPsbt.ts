/**
 * PSBT Signing
 *
 * Standalone function for signing PSBTs with Trezor.
 * Receives connection state as a parameter instead of using `this`.
 */

import TrezorConnect from '@trezor/connect-web';
import { createLogger } from '../../../../utils/logger';
import type { PSBTSignRequest, PSBTSignResponse } from '../../types';
import { validatePsbtSigningRequest } from '../../psbtAccountBinding';
import type { TrezorConnection } from './types';
import { isMultisigInput } from './multisig';
import { fetchRefTxs } from './refTxs';
import { getDeviceFingerprintBuffer } from './signPsbtNetwork';
import { getTrezorScriptType } from './pathUtils';
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
    const deviceFingerprint = connection.fingerprint;
    const validated = validatePsbtSigningRequest(request, deviceFingerprint);
    const psbt = validated.psbt;
    const boundRequest: PSBTSignRequest = {
      ...request,
      signingContext: validated.context,
    };
    const scriptType = getTrezorScriptType(validated.accountPath);
    const isTestnet = validated.network !== 'mainnet';
    const coin = isTestnet ? 'Testnet' : 'Bitcoin';
    log.info('Using coin type for signing', {
      coin,
      isTestnet,
      accountPath: validated.accountPath,
    });

    const deviceFingerprintBuffer = getDeviceFingerprintBuffer(connection);

    const inputs = buildTrezorInputs(
      psbt,
      boundRequest,
      scriptType,
      deviceFingerprintBuffer,
      deviceFingerprint
    );
    const isMultisig = psbt.data.inputs.some(input => isMultisigInput(input));
    const outputs = buildTrezorOutputs(
      psbt,
      boundRequest,
      scriptType,
      isTestnet,
      deviceFingerprintBuffer,
      deviceFingerprint
    );

    const refTxs = await fetchRefTxs(psbt, validated.context.walletId);
    logRefTxAmountMismatches(psbt, refTxs);
    const txFromPsbt = getUnsignedTransactionFromPsbt(psbt);

    // Pass version and locktime from PSBT so Trezor signs the same transaction.
    const result = await TrezorConnect.signTransaction({
      inputs,
      outputs,
      refTxs: refTxs.length > 0 ? refTxs : undefined,
      coin,
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
