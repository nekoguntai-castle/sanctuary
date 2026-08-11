/** Fail-closed Ledger PSBT signing against server-issued wallet evidence. */

import type { AppClient } from '@ledgerhq/ledger-bitcoin';
import { createLogger } from '../../../../utils/logger';
import type { PSBTSignRequest, PSBTSignResponse } from '../../types';
import { validatePsbtSigningRequest } from '../../psbtAccountBinding';
import { getUnsupportedMultisigHardwareSigningMessage } from '../../signingSupport';
import { assertLedgerSession } from './session';
import { buildLedgerDefaultPolicy } from './walletPolicy';

const log = createLogger('LedgerAdapter');

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');

function assertSignatureMatchesInput(
  validated: ReturnType<typeof validatePsbtSigningRequest>,
  inputIndex: number,
  pubkey: Uint8Array,
): void {
  const binding = validated.context.inputs.find(input => input.inputIndex === inputIndex);
  if (!binding) throw new Error(`Ledger returned a signature for unbound input ${inputIndex}`);
  const signer = binding.signerOrigins.find(origin => (
    origin.masterFingerprint === validated.connectedSigner.masterFingerprint
  ));
  if (!signer) {
    throw new Error(`Ledger returned a signature from an unexpected key for input ${inputIndex}`);
  }
  let expectedPubkey = signer.pubkey;
  if (validated.context.scriptType === 'taproot') {
    const script = validated.psbt.data.inputs[inputIndex]?.witnessUtxo?.script;
    if (!script || script.length !== 34 || script[0] !== 0x51 || script[1] !== 0x20) {
      throw new Error(`Ledger Taproot input ${inputIndex} is missing its verified output key`);
    }
    // Ledger signs BIP86 key-path spends with the tweaked output key, not the
    // internal derivation key recorded in tapBip32Derivation.
    expectedPubkey = hex(script.slice(2));
  }
  if (expectedPubkey !== hex(pubkey)) {
    throw new Error(`Ledger returned a signature from an unexpected key for input ${inputIndex}`);
  }
}

/** Sign only after the connected Ledger exactly matches the wallet account. */
export async function signPsbt(
  appClient: AppClient,
  request: PSBTSignRequest,
): Promise<PSBTSignResponse> {
  const masterFpHex = (await appClient.getMasterFingerprint()).toLowerCase();
  const validated = validatePsbtSigningRequest(request, masterFpHex);
  if (validated.context.walletType === 'multi_sig') {
    throw new Error(getUnsupportedMultisigHardwareSigningMessage('Ledger'));
  }

  await assertLedgerSession(appClient, validated.network === 'mainnet' ? 'mainnet' : 'testnet');
  const accountPath = validated.connectedSigner.accountPath;
  const { policy: walletPolicy } = await buildLedgerDefaultPolicy(
    appClient,
    accountPath,
    validated.connectedSigner.masterFingerprint,
    validated.connectedSigner.accountXpub,
  );

  log.info('Calling Ledger signPsbt with verified wallet policy', {
    accountPath,
    scriptType: validated.context.scriptType,
    inputCount: validated.context.inputs.length,
    changeOutputCount: validated.changeOutputIndexes.length,
  });
  const signatures = await appClient.signPsbt(request.psbt, walletPolicy, null);
  const signedInputs = new Set<number>();
  for (const [inputIndex, partialSig] of signatures) {
    if (signedInputs.has(inputIndex)) {
      throw new Error(`Ledger returned duplicate signatures for input ${inputIndex}`);
    }
    signedInputs.add(inputIndex);
    assertSignatureMatchesInput(validated, inputIndex, partialSig.pubkey);
    if (validated.context.scriptType === 'taproot') {
      if (partialSig.tapleafHash) {
        throw new Error('Ledger Taproot script-path signatures are not supported');
      }
      if (partialSig.pubkey.length !== 32 || ![64, 65].includes(partialSig.signature.length)) {
        throw new Error(`Ledger returned malformed Taproot key-path signature data for input ${inputIndex}`);
      }
    } else {
      if (partialSig.tapleafHash) {
        throw new Error(`Ledger returned unexpected Taproot script-path data for input ${inputIndex}`);
      }
      if (partialSig.pubkey.length !== 33) {
        throw new Error(`Ledger returned malformed public key for input ${inputIndex}`);
      }
    }
  }
  for (const [inputIndex, partialSig] of signatures) {
    if (validated.context.scriptType === 'taproot') {
      validated.psbt.updateInput(inputIndex, { tapKeySig: partialSig.signature });
    } else {
      validated.psbt.updateInput(inputIndex, {
        partialSig: [{ pubkey: partialSig.pubkey, signature: partialSig.signature }],
      });
    }
  }
  validated.psbt.finalizeAllInputs();
  const reconstructedPsbt = validated.psbt.toBase64();
  return {
    psbt: reconstructedPsbt,
    signatures: signatures.length,
    ledgerArtifact: {
      type: 'ledger-signed-psbt',
      sourcePsbt: request.psbt,
      // Script-path signatures are rejected before PSBT mutation, so every
      // artifact entry represents either ECDSA or a BIP371 key-path signature.
      signatures: signatures.map(([inputIndex, signature]) => ({
        inputIndex,
        pubkey: hex(signature.pubkey),
        signature: hex(signature.signature),
      })),
      reconstructedPsbt,
    },
  };
}
