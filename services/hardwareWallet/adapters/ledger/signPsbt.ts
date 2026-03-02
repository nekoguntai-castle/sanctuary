/**
 * PSBT Signing
 *
 * Standalone function for signing PSBTs with Ledger.
 * Receives connection state as a parameter instead of using `this`.
 */

import type { AppClient } from 'ledger-bitcoin';
import { DefaultWalletPolicy } from 'ledger-bitcoin';
import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../../utils/logger';
import type { PSBTSignRequest, PSBTSignResponse } from '../../types';
import { extractAccountPath, inferScriptTypeFromPath, getDescriptorTemplate } from './utils';

const log = createLogger('LedgerAdapter');

/**
 * Sign a PSBT with a Ledger device
 */
export async function signPsbt(
  appClient: AppClient,
  request: PSBTSignRequest
): Promise<PSBTSignResponse> {
  log.info('signPSBT called', {
    hasRequest: !!request,
    psbtLength: request?.psbt?.length || 0,
    inputPathsCount: request?.inputPaths?.length || 0,
    accountPath: request?.accountPath,
    scriptType: request?.scriptType,
  });

  // Parse PSBT to extract derivation paths
  const tempPsbt = bitcoin.Psbt.fromBase64(request.psbt);
  let detectedAccountPath: string | null = null;

  for (const input of tempPsbt.data.inputs) {
    if (input.bip32Derivation && input.bip32Derivation.length > 0) {
      const fullPath = input.bip32Derivation[0].path;
      if (fullPath) {
        detectedAccountPath = extractAccountPath(fullPath);
        log.info('Detected account path from PSBT:', { detectedAccountPath });
        break;
      }
    }
  }

  // Determine account path and script type
  let accountPath = request.accountPath || detectedAccountPath;
  let scriptType = request.scriptType;

  if (!accountPath && request.inputPaths && request.inputPaths.length > 0) {
    accountPath = extractAccountPath(request.inputPaths[0]);
  }
  if (!accountPath) {
    accountPath = "m/84'/0'/0'";
  }

  if (!scriptType) {
    scriptType = inferScriptTypeFromPath(accountPath);
  }

  log.info('Using account path and script type', { accountPath, scriptType });

  // Get master fingerprint
  const masterFpHex = await appClient.getMasterFingerprint();
  log.info('Got master fingerprint', { masterFpHex });

  // Get account xpub
  const xpub = await appClient.getExtendedPubkey(accountPath);
  log.info('Got xpub', { xpubPrefix: xpub.substring(0, 20) });

  // Create wallet policy key string
  const pathWithoutM = accountPath.replace(/^m\//, '');
  const keyInfo = `[${masterFpHex}/${pathWithoutM}]${xpub}`;

  // Create DefaultWalletPolicy
  const descriptorTemplate = getDescriptorTemplate(scriptType);
  const walletPolicy = new DefaultWalletPolicy(descriptorTemplate, keyInfo);

  log.info('Created wallet policy', { descriptorTemplate, keyInfo });

  // Parse and fix PSBT fingerprints
  const psbt = bitcoin.Psbt.fromBase64(request.psbt);
  const connectedFpBuffer = Buffer.from(masterFpHex, 'hex');

  let fingerprintMismatchFixed = false;
  let missingBip32Derivation = false;

  psbt.data.inputs.forEach((input, idx) => {
    if (!input.bip32Derivation || input.bip32Derivation.length === 0) {
      missingBip32Derivation = true;
      log.warn(`Input ${idx} is missing bip32Derivation`);
    }

    if (input.bip32Derivation && input.bip32Derivation.length > 0) {
      input.bip32Derivation.forEach((deriv) => {
        const fpHex = deriv.masterFingerprint.toString('hex');
        const matches = fpHex.toLowerCase() === masterFpHex.toLowerCase();

        if (!matches) {
          log.warn(`Updating fingerprint from ${fpHex} to ${masterFpHex} for input ${idx}`);
          deriv.masterFingerprint = connectedFpBuffer;
          fingerprintMismatchFixed = true;
        }
      });
    }
  });

  if (fingerprintMismatchFixed) {
    log.info('Fixed fingerprint mismatches in PSBT');
  }

  if (missingBip32Derivation) {
    throw new Error(
      'PSBT is missing bip32Derivation data required by Ledger. ' +
      'Ensure wallet descriptor is properly configured with xpub and fingerprint.'
    );
  }

  // Sign the PSBT
  const updatedPsbtBase64 = psbt.toBase64();
  log.info('Calling appClient.signPsbt...');

  const signatures = await appClient.signPsbt(updatedPsbtBase64, walletPolicy, null);

  log.info('Got signatures from device', { signatureCount: signatures.length });

  // Apply signatures to PSBT
  for (const [inputIndex, partialSig] of signatures) {
    psbt.updateInput(inputIndex, {
      partialSig: [{
        pubkey: partialSig.pubkey,
        signature: partialSig.signature,
      }],
    });
  }

  // Finalize
  psbt.finalizeAllInputs();

  log.info('PSBT signed and finalized successfully', { signatureCount: signatures.length });

  return {
    psbt: psbt.toBase64(),
    signatures: signatures.length,
  };
}
