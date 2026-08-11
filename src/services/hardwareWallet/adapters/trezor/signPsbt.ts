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
import { validateAndApplyTrezorSignatures } from './signPsbtSignatures';
import {
  getSerializedTrezorTx,
  getUnsignedTransactionFromPsbt,
  assertRefTxAmountsMatch,
  assertAuthenticatedTrezorArtifact,
  assertSignedTransactionIntent,
} from './signPsbtValidation';
import { mapTrezorSigningError } from './signPsbtErrors';
import { assertSessionIdentity, connectDevice } from './sessionIdentity';

const log = createLogger('TrezorAdapter');

const assertEveryInputBound = (
  inputCount: number,
  bindings: ReadonlyArray<{ inputIndex: number }>
): void => {
  const indexes = bindings.map((binding) => binding.inputIndex).sort((a, b) => a - b);
  if (indexes.length !== inputCount || indexes.some((index, position) => index !== position)) {
    throw new Error('Trezor signing requires wallet binding for every transaction input');
  }
};

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
    const session = connection.session;
    if (!session) throw new Error('Trezor selected session is unavailable');
    const validated = validatePsbtSigningRequest(request, deviceFingerprint);
    const psbt = validated.psbt;
    assertEveryInputBound(psbt.txInputs.length, validated.context.inputs);
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
    const isMultisig = psbt.data.inputs.some((input) => isMultisigInput(input));
    const outputs = buildTrezorOutputs(
      psbt,
      boundRequest,
      scriptType,
      isTestnet,
      deviceFingerprintBuffer,
      deviceFingerprint
    );

    const refTxs = await fetchRefTxs(psbt, validated.context.walletId);
    assertRefTxAmountsMatch(psbt, refTxs);
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
      device: connectDevice(session),
    });
    if (result.success) assertSessionIdentity(result.device, session);

    const signedTxHex = getSerializedTrezorTx(result);
    assertSignedTransactionIntent(txFromPsbt, signedTxHex);
    const connectSignatures =
      result.success && Array.isArray(result.payload.signatures) ? result.payload.signatures : [];
    const { validatedPsbt, addedSignatures } = validateAndApplyTrezorSignatures(
      psbt,
      connectSignatures,
      deviceFingerprintBuffer,
      scriptType === 'SPENDTAPROOT'
    );
    assertAuthenticatedTrezorArtifact(validatedPsbt, signedTxHex, !isMultisig);

    return {
      // Connect returns a native tuple rather than a PSBT. For multisig state,
      // persist the clone containing only the signatures verified above.
      psbt: isMultisig ? validatedPsbt.toBase64() : undefined,
      rawTx: isMultisig ? undefined : signedTxHex,
      signatures: addedSignatures,
      trezorArtifact: {
        type: 'trezor-connect-transaction',
        sourcePsbt: request.psbt,
        connectSignatures: [...connectSignatures],
        serializedTx: signedTxHex,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Trezor signing failed', { error: message });
    throw new Error(mapTrezorSigningError(message));
  }
};
