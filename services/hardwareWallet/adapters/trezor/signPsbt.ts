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
import { getTrezorScriptType, pathToAddressN, validateSatoshiAmount } from './pathUtils';
import { buildTrezorMultisig, isMultisigInput } from './multisig';
import { fetchRefTxs } from './refTxs';

const log = createLogger('TrezorAdapter');

/**
 * Sign a PSBT with Trezor.
 * Note: Trezor returns a fully signed raw transaction, not a PSBT.
 */
export async function signPsbtWithTrezor(
  request: PSBTSignRequest,
  connection: TrezorConnection
): Promise<PSBTSignResponse> {
  log.info('Trezor signPSBT called', {
    psbtLength: request.psbt.length,
    inputPathsCount: request.inputPaths?.length || 0,
  });

  try {
    const psbt = bitcoin.Psbt.fromBase64(request.psbt);

    // Determine script type
    let scriptType: 'SPENDADDRESS' | 'SPENDP2SHWITNESS' | 'SPENDWITNESS' | 'SPENDTAPROOT' = 'SPENDWITNESS';
    if (request.accountPath) {
      scriptType = getTrezorScriptType(request.accountPath);
    } else if (request.inputPaths && request.inputPaths.length > 0) {
      scriptType = getTrezorScriptType(request.inputPaths[0]);
    }

    // Determine coin based on path - check multiple sources for testnet indicator
    // BIP-44/48/84 use coin_type 1' for testnet, 0' for mainnet
    // Pattern: m/purpose'/coin_type'/... where coin_type is the second component
    let isTestnet = false;
    let networkSource = 'default';

    // First try request paths
    const pathToCheck = request.accountPath || request.inputPaths?.[0] || '';
    if (pathToCheck) {
      if (pathToCheck.includes("/1'/") || pathToCheck.includes("/1h/")) {
        isTestnet = true;
        networkSource = 'request.path';
      } else if (pathToCheck.includes("/0'/") || pathToCheck.includes("/0h/")) {
        networkSource = 'request.path';
      }
    }

    // Always check bip32Derivation from first input as fallback/confirmation
    const firstInputDeriv = psbt.data.inputs[0]?.bip32Derivation?.[0];
    if (firstInputDeriv?.path) {
      const derivPath = firstInputDeriv.path;
      // Check for testnet coin type (second hardened component = 1)
      // e.g., m/48'/1'/0'/2' or 48h/1h/0h/2h
      const testnetMatch = derivPath.match(/^m?\/?\d+[h']\/1[h']\//);
      const mainnetMatch = derivPath.match(/^m?\/?\d+[h']\/0[h']\//);

      if (testnetMatch) {
        isTestnet = true;
        networkSource = 'bip32Derivation';
      } else if (mainnetMatch && networkSource === 'default') {
        networkSource = 'bip32Derivation';
      }

      log.info('Network detection from PSBT', {
        derivPath,
        testnetMatch: !!testnetMatch,
        mainnetMatch: !!mainnetMatch,
        isTestnet
      });
    }

    const coin = isTestnet ? 'Testnet' : 'Bitcoin';
    log.info('Using coin type for signing', { coin, isTestnet, networkSource, pathToCheck: pathToCheck || '(empty)' });

    // Multisig PSBTs contain bip32Derivation entries for ALL cosigners in each input/output.
    // Trezor requires we use the derivation path that belongs to THIS device (matched by
    // master fingerprint), not an arbitrary cosigner's path, or it will reject with
    // "Forbidden key path" or "wrong derivation path" error.
    const deviceFingerprint = connection.fingerprint;
    const deviceFingerprintBuffer = deviceFingerprint
      ? Buffer.from(deviceFingerprint, 'hex')
      : null;

    // For multisig, verify this device is actually a cosigner
    const firstInput = psbt.data.inputs[0];
    if (firstInput?.bip32Derivation && firstInput.bip32Derivation.length > 1 && deviceFingerprintBuffer) {
      const isCosigner = firstInput.bip32Derivation.some(d =>
        d.masterFingerprint.equals(deviceFingerprintBuffer)
      );
      if (!isCosigner) {
        const cosignerFingerprints = firstInput.bip32Derivation.map(d =>
          d.masterFingerprint.toString('hex')
        );
        log.error('Device is not a cosigner for this multisig wallet', {
          deviceFingerprint,
          cosignerFingerprints,
        });
        throw new Error(
          `This Trezor (${deviceFingerprint}) is not a cosigner for this multisig wallet. ` +
          `Expected one of: ${cosignerFingerprints.join(', ')}. ` +
          `Please connect the correct device.`
        );
      }
    }

    // Build Trezor inputs
    const inputs = psbt.data.inputs.map((input, idx) => {
      let addressN: number[] = [];
      let derivationPath: string | undefined;

      if (input.bip32Derivation && input.bip32Derivation.length > 0) {
        // For multisig, find the bip32Derivation entry matching this device's fingerprint
        let matchingDerivation = input.bip32Derivation[0]; // Default to first

        if (deviceFingerprintBuffer && input.bip32Derivation.length > 1) {
          const matching = input.bip32Derivation.find(d =>
            d.masterFingerprint.equals(deviceFingerprintBuffer)
          );
          if (matching) {
            matchingDerivation = matching;
            log.info('Found matching bip32Derivation for device', {
              inputIdx: idx,
              fingerprint: deviceFingerprint,
              path: matching.path,
            });
          } else {
            log.warn('No matching bip32Derivation found for device fingerprint', {
              inputIdx: idx,
              deviceFingerprint,
              availableFingerprints: input.bip32Derivation.map(d =>
                d.masterFingerprint.toString('hex')
              ),
            });
          }
        }

        derivationPath = matchingDerivation.path;
        addressN = pathToAddressN(derivationPath);
      } else if (request.inputPaths && request.inputPaths[idx]) {
        derivationPath = request.inputPaths[idx];
        addressN = pathToAddressN(derivationPath);
      }

      const txInput = psbt.txInputs[idx];
      const prevHash = Buffer.from(txInput.hash).reverse().toString('hex');

      const trezorInput: any = {
        address_n: addressN,
        prev_hash: prevHash,
        prev_index: txInput.index,
        sequence: txInput.sequence,
        script_type: scriptType,
      };

      if (input.witnessUtxo) {
        trezorInput.amount = validateSatoshiAmount(input.witnessUtxo.value, `Input ${idx}`);
      }

      // Add multisig structure for multisig inputs (required for Trezor to validate multisig paths)
      if (isMultisigInput(input) && input.bip32Derivation) {
        const multisig = buildTrezorMultisig(input.witnessScript, input.bip32Derivation, request.multisigXpubs);
        if (multisig) {
          trezorInput.multisig = multisig;
          log.info('Built multisig structure for input', {
            inputIdx: idx,
            m: multisig.m,
            pubkeyCount: multisig.pubkeys.length,
            hasXpubs: !!request.multisigXpubs,
          });
        }
      }

      // Log the complete Trezor input for debugging
      log.info('TREZOR INPUT BUILT', {
        inputIdx: idx,
        prevHash: trezorInput.prev_hash,
        prevIndex: trezorInput.prev_index,
        amount: trezorInput.amount,
        sequence: trezorInput.sequence,
        scriptType: trezorInput.script_type,
        hasMultisig: !!trezorInput.multisig,
        addressN: trezorInput.address_n,
        // Log witnessUtxo from PSBT for comparison
        psbtWitnessUtxoValue: input.witnessUtxo?.value,
        psbtWitnessUtxoScript: input.witnessUtxo?.script?.toString('hex'),
      });

      return trezorInput;
    });

    // Check if this is a multisig transaction (for signature extraction later)
    const isMultisig = psbt.data.inputs.some(input => isMultisigInput(input));

    // Build Trezor outputs
    const outputs = psbt.txOutputs.map((output, idx) => {
      const psbtOutput = psbt.data.outputs[idx];
      const isChange = request.changeOutputs?.includes(idx) ||
        (psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 0);

      if (isChange && psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 0) {
        // For multisig, find the bip32Derivation entry matching this device's fingerprint
        let matchingDerivation = psbtOutput.bip32Derivation[0]; // Default to first

        if (deviceFingerprintBuffer && psbtOutput.bip32Derivation.length > 1) {
          const matching = psbtOutput.bip32Derivation.find(d =>
            d.masterFingerprint.equals(deviceFingerprintBuffer)
          );
          if (matching) {
            matchingDerivation = matching;
          }
        }

        const outputScriptType = scriptType === 'SPENDADDRESS' ? 'PAYTOADDRESS' as const :
          scriptType === 'SPENDP2SHWITNESS' ? 'PAYTOP2SHWITNESS' as const :
          scriptType === 'SPENDTAPROOT' ? 'PAYTOTAPROOT' as const : 'PAYTOWITNESS' as const;

        const changeOutput: any = {
          address_n: pathToAddressN(matchingDerivation.path),
          amount: validateSatoshiAmount(output.value, `Output ${idx}`),
          script_type: outputScriptType,
        };

        // Add multisig structure for multisig change outputs
        if (psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 1 && psbtOutput.witnessScript) {
          const multisig = buildTrezorMultisig(psbtOutput.witnessScript, psbtOutput.bip32Derivation, request.multisigXpubs);
          if (multisig) {
            changeOutput.multisig = multisig;
            log.info('Built multisig structure for change output', {
              outputIdx: idx,
              m: multisig.m,
              pubkeyCount: multisig.pubkeys.length,
            });
          }
        }

        return changeOutput;
      } else {
        const address = bitcoin.address.fromOutputScript(
          output.script,
          isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
        );

        return {
          address,
          amount: validateSatoshiAmount(output.value, `Output ${idx}`),
          script_type: 'PAYTOADDRESS' as const,
        };
      }
    });

    // Fetch reference transactions
    const refTxs = await fetchRefTxs(psbt);

    // Verify PSBT witnessUtxo values match refTx outputs (only log mismatches)
    for (let i = 0; i < psbt.txInputs.length; i++) {
      const txInput = psbt.txInputs[i];
      const psbtInput = psbt.data.inputs[i];
      const txid = Buffer.from(txInput.hash).reverse().toString('hex');
      const vout = txInput.index;

      const refTx = refTxs.find(rt => rt.hash === txid);
      if (refTx && refTx.bin_outputs && psbtInput.witnessUtxo) {
        const refOutput = refTx.bin_outputs[vout];
        if (refOutput) {
          const psbtAmount = psbtInput.witnessUtxo.value;
          const refAmount = refOutput.amount;

          if (psbtAmount !== refAmount) {
            log.error('Input amount mismatch between PSBT and reference transaction', {
              inputIndex: i,
              txid,
              vout,
              psbtAmount,
              refAmount,
            });
          }
        }
      }
    }

    // Get the derivation path from the first input (after fingerprint matching)
    let accountPath = request.accountPath || request.inputPaths?.[0];

    // Try to get account path from first input's bip32Derivation (more reliable for multisig)
    if (firstInput?.bip32Derivation && firstInput.bip32Derivation.length > 0) {
      let matchingDerivation = firstInput.bip32Derivation[0];
      if (deviceFingerprintBuffer && firstInput.bip32Derivation.length > 1) {
        const matching = firstInput.bip32Derivation.find(d =>
          d.masterFingerprint.equals(deviceFingerprintBuffer)
        );
        // Invariant: the earlier multisig cosigner check guarantees a match here.
        matchingDerivation = matching!;
      }
      accountPath = matchingDerivation.path;
    }

    // Get PSBT transaction details for version/locktime to pass to Trezor
    const psbtTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
    const txFromPsbt = bitcoin.Transaction.fromBuffer(psbtTx.toBuffer());

    // Sign with Trezor
    // CRITICAL: Pass version and locktime from PSBT to ensure sighash matches
    const result = await TrezorConnect.signTransaction({
      inputs,
      outputs,
      refTxs: refTxs.length > 0 ? refTxs : undefined,
      coin,
      push: false,
      version: txFromPsbt.version,
      locktime: txFromPsbt.locktime,
    });

    if (!result.success) {
      const errorMsg = 'error' in result.payload ? result.payload.error : 'Signing failed';
      throw new Error(errorMsg);
    }

    // Trezor returns fully signed raw transaction
    const signedTxHex = result.payload.serializedTx;

    // Validate Trezor's signed transaction matches PSBT (only log mismatches)
    if (signedTxHex) {
      const signedTx = bitcoin.Transaction.fromHex(signedTxHex);

      // Check version/locktime match
      if (txFromPsbt.version !== signedTx.version) {
        log.error('Transaction version mismatch - Trezor signed different version', {
          psbtVersion: txFromPsbt.version,
          trezorVersion: signedTx.version,
        });
      }
      if (txFromPsbt.locktime !== signedTx.locktime) {
        log.error('Transaction locktime mismatch', {
          psbtLocktime: txFromPsbt.locktime,
          trezorLocktime: signedTx.locktime,
        });
      }

      // Check outputs match
      for (let i = 0; i < Math.min(txFromPsbt.outs.length, signedTx.outs.length); i++) {
        const psbtOut = txFromPsbt.outs[i];
        const trezorOut = signedTx.outs[i];
        if (psbtOut.value !== trezorOut.value || !psbtOut.script.equals(trezorOut.script)) {
          log.error('Output mismatch between PSBT and Trezor signed transaction', {
            outputIndex: i,
            psbtValue: psbtOut.value,
            trezorValue: trezorOut.value,
            psbtScriptHex: psbtOut.script.toString('hex'),
            trezorScriptHex: trezorOut.script.toString('hex'),
          });
        }
      }

      // Check inputs match
      for (let i = 0; i < Math.min(txFromPsbt.ins.length, signedTx.ins.length); i++) {
        const psbtIn = txFromPsbt.ins[i];
        const trezorIn = signedTx.ins[i];
        if (!psbtIn.hash.equals(trezorIn.hash) || psbtIn.index !== trezorIn.index || psbtIn.sequence !== trezorIn.sequence) {
          log.error('Input mismatch between PSBT and Trezor signed transaction', {
            inputIndex: i,
            psbtPrevHash: Buffer.from(psbtIn.hash).reverse().toString('hex'),
            trezorPrevHash: Buffer.from(trezorIn.hash).reverse().toString('hex'),
            psbtPrevIndex: psbtIn.index,
            trezorPrevIndex: trezorIn.index,
            psbtSequence: psbtIn.sequence,
            trezorSequence: trezorIn.sequence,
          });
        }
      }
    }

    // For multisig: extract signatures from the signed transaction and add to PSBT
    if (isMultisig && signedTxHex) {
      try {
        const signedTx = bitcoin.Transaction.fromHex(signedTxHex);

        // Process each input to extract Trezor's signature
        for (let i = 0; i < signedTx.ins.length; i++) {
          const witness = signedTx.ins[i].witness;
          const psbtInput = psbt.data.inputs[i];

          if (witness && witness.length > 0 && psbtInput.witnessScript) {
            // For P2WSH multisig, witness is: [OP_0, sig1, sig2, ..., witnessScript]
            // OP_0 is empty buffer for CHECKMULTISIG bug
            // Last item is the witnessScript
            // Middle items are signatures

            const witnessScript = psbtInput.witnessScript;

            // Verify Trezor's witnessScript matches PSBT's
            const trezorWitnessScript = witness[witness.length - 1];
            if (!witnessScript.equals(trezorWitnessScript)) {
              log.error('WitnessScript mismatch - Trezor signed with different script', {
                inputIndex: i,
                psbtWitnessScriptHex: witnessScript.toString('hex'),
                trezorWitnessScriptHex: trezorWitnessScript.toString('hex'),
              });
            }

            // Extract pubkeys from witnessScript
            // Format: OP_M [pubkey1] [pubkey2] ... OP_N OP_CHECKMULTISIG
            const pubkeys: Buffer[] = [];
            let offset = 1; // Skip OP_M
            while (offset < witnessScript.length - 2) {
              const len = witnessScript[offset];
              if (len === 0x21 || len === 0x41) { // Compressed (33) or uncompressed (65) pubkey
                offset++;
                pubkeys.push(witnessScript.slice(offset, offset + len));
                offset += len;
              } else if (len >= 0x51 && len <= 0x60) {
                // OP_N (number of keys) - we're done
                break;
              } else {
                offset++;
              }
            }

            // Signatures are in witness[1] to witness[length-2] (skip OP_0 and witnessScript)
            const signatures = witness.slice(1, witness.length - 1).filter(sig => sig.length > 0);

            // Find Trezor's pubkey using bip32Derivation and device fingerprint
            let trezorPubkey: Buffer | null = null;
            if (deviceFingerprintBuffer && psbtInput.bip32Derivation) {
              const trezorDerivation = psbtInput.bip32Derivation.find(d =>
                d.masterFingerprint.equals(deviceFingerprintBuffer)
              );
              if (trezorDerivation) {
                trezorPubkey = trezorDerivation.pubkey;
              }
            }

            // Add signature to Trezor's pubkey
            if (trezorPubkey && signatures.length > 0) {
              const sig = signatures[0]; // Trezor's rawTx should have exactly 1 sig for this input

              // Check if this pubkey already has a signature
              const existingSig = psbtInput.partialSig?.find(
                ps => ps.pubkey.equals(trezorPubkey!)
              );
              if (!existingSig) {
                if (!psbtInput.partialSig) {
                  psbtInput.partialSig = [];
                }
                psbtInput.partialSig.push({
                  pubkey: trezorPubkey,
                  signature: sig,
                });
              }
            } else {
              log.warn('Could not match Trezor signature to pubkey', {
                inputIndex: i,
                hasTrezorPubkey: !!trezorPubkey,
                signaturesFound: signatures.length,
              });
            }
          }
        }
      } catch (extractError) {
        log.warn('Failed to extract signatures from Trezor rawTx', {
          error: extractError instanceof Error ? extractError.message : String(extractError),
        });
        // Continue without extraction - rawTx is still available as fallback
      }
    }

    return {
      psbt: psbt.toBase64(), // PSBT with partial signatures for multisig
      rawTx: signedTxHex, // Fully signed transaction (for single-sig direct broadcast)
      signatures: inputs.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Trezor signing failed', { error: message });

    if (message.includes('Cancelled') || message.includes('cancelled') || message.includes('rejected')) {
      throw new Error('Transaction rejected on Trezor. Please approve the transaction on your device.');
    }
    if (message.includes('PIN')) {
      throw new Error('Incorrect PIN. Please try again.');
    }
    if (message.includes('Passphrase')) {
      throw new Error('Passphrase entry cancelled.');
    }
    if (message.includes('Device disconnected') || message.includes('no device')) {
      throw new Error('Trezor disconnected. Please reconnect and try again.');
    }
    if (message.includes('Forbidden key path')) {
      throw new Error(
        'Trezor blocked this derivation path. In Trezor Suite, go to Settings > Device > Safety Checks and set to "Prompt" to allow multisig signing.'
      );
    }
    if (message.includes('wrong derivation path') || message.includes('Wrong derivation path')) {
      throw new Error(
        'The derivation path does not match your Trezor account. Please ensure: ' +
        '(1) You are using the same passphrase (or no passphrase) as when you registered the device, and ' +
        '(2) In Trezor Suite, go to Settings > Device > Safety Checks and set to "Prompt" to allow non-standard paths.'
      );
    }

    throw new Error(`Failed to sign with Trezor: ${message}`);
  }
}
