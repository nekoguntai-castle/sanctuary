/** Fail-closed Ledger PSBT signing against server-issued wallet evidence. */

import type { AppClient } from '@ledgerhq/ledger-bitcoin';
import { DefaultWalletPolicy } from '@ledgerhq/ledger-bitcoin';
import { createLogger } from '../../../../utils/logger';
import type { PSBTSignRequest, PSBTSignResponse } from '../../types';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import { validatePsbtSigningRequest } from '../../psbtAccountBinding';
import { getDescriptorTemplate } from './utils';
import { getUnsupportedMultisigHardwareSigningMessage } from '../../signingSupport';

const log = createLogger('LedgerAdapter');

const ledgerScriptType = (
  scriptType: PsbtSigningContext['scriptType'],
): NonNullable<PSBTSignRequest['scriptType']> => {
  switch (scriptType) {
    case 'legacy': return 'p2pkh';
    case 'nested_segwit': return 'p2sh-p2wpkh';
    case 'native_segwit': return 'p2wpkh';
    case 'taproot': return 'p2tr';
  }
};

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

  const accountPath = validated.connectedSigner.accountPath;
  const xpub = await appClient.getExtendedPubkey(accountPath);
  if (xpub !== validated.connectedSigner.accountXpub) {
    throw new Error('Connected Ledger account xpub does not match the wallet-selected account');
  }

  const scriptType = ledgerScriptType(validated.context.scriptType);
  const descriptorTemplate = getDescriptorTemplate(scriptType);
  const keyInfo = `[${masterFpHex}/${accountPath.replace(/^m\//, '')}]${xpub}`;
  const walletPolicy = new DefaultWalletPolicy(descriptorTemplate, keyInfo);

  log.info('Calling Ledger signPsbt with verified wallet policy', {
    accountPath,
    descriptorTemplate,
    inputCount: validated.context.inputs.length,
    changeOutputCount: validated.changeOutputIndexes.length,
  });
  const signatures = await appClient.signPsbt(request.psbt, walletPolicy, null);
  for (const [inputIndex, partialSig] of signatures) {
    if (!validated.context.inputs.some(binding => binding.inputIndex === inputIndex)) {
      throw new Error(`Ledger returned a signature for unbound input ${inputIndex}`);
    }
    validated.psbt.updateInput(inputIndex, {
      partialSig: [{
        pubkey: partialSig.pubkey,
        signature: partialSig.signature,
      }],
    });
  }
  validated.psbt.finalizeAllInputs();
  return {
    psbt: validated.psbt.toBase64(),
    signatures: signatures.length,
  };
}
