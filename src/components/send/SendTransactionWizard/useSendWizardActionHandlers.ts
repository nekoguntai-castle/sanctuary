import { useCallback } from 'react';
import { createLogger } from '../../../utils/logger';
import type { TransactionData, UseSendTransactionActionsResult } from '../../../hooks/send/useSendTransactionActions';
import type { SendWizardActionHandlerProps } from './types';

const log = createLogger('SendTxWizard');

async function resolveTransactionData(actions: UseSendTransactionActionsResult): Promise<TransactionData | null> {
  return actions.txData || actions.createTransaction();
}

async function broadcastSignedRawTx(actions: UseSendTransactionActionsResult): Promise<boolean> {
  if (!actions.signedRawTx) {
    return false;
  }

  log.info('Broadcasting with signedRawTx');
  await actions.broadcastTransaction(undefined, actions.signedRawTx);
  return true;
}

async function broadcastUploadedSignedPsbt(actions: UseSendTransactionActionsResult): Promise<boolean> {
  if (actions.signedDevices.size === 0 || !actions.unsignedPsbt) {
    return false;
  }

  await actions.broadcastTransaction(actions.unsignedPsbt);
  return true;
}

async function createDownloadablePsbtIfNeeded(actions: UseSendTransactionActionsResult) {
  if (!actions.unsignedPsbt) {
    await actions.createTransaction();
  }
}

// USB signing happens on the review step (signWithDevice), which holds the
// only hardware-wallet connection and releases it after each attempt. By the
// time this runs there is a signed artifact to broadcast or there is not.
async function signAndBroadcastTransaction({ actions }: SendWizardActionHandlerProps) {

  log.debug('handleSignAndBroadcast called', {
    hasSignedRawTx: !!actions.signedRawTx,
    signedRawTxPreview: actions.signedRawTx ? `${actions.signedRawTx.substring(0, 50)}...` : null,
  });

  if (await broadcastSignedRawTx(actions)) {
    return;
  }

  const txData = await resolveTransactionData(actions);
  if (!txData) {
    return;
  }

  if (await broadcastUploadedSignedPsbt(actions)) {
    return;
  }

  await createDownloadablePsbtIfNeeded(actions);
}

async function signMultisigTransaction(actions: UseSendTransactionActionsResult) {
  if (!actions.txData) {
    await actions.createTransaction();
  }
}

export function useSendWizardActionHandlers({
  actions,
  walletId,
}: SendWizardActionHandlerProps) {

  const handleSignAndBroadcast = useCallback(async () => {
    await signAndBroadcastTransaction({ walletId, actions });
  }, [walletId, actions]);

  const handleSign = useCallback(async () => {
    await signMultisigTransaction(actions);
  }, [actions]);

  const handleSaveDraft = useCallback(async () => {
    await actions.saveDraft();
  }, [actions]);

  return {
    handleSign,
    handleSignAndBroadcast,
    handleSaveDraft,
  };
}
