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

async function broadcastWithConnectedHardwareWallet({
  actions,
  hardwareWallet,
}: SendWizardActionHandlerProps, txData: TransactionData): Promise<boolean> {
  if (!hardwareWallet.isConnected || !hardwareWallet.device) {
    return false;
  }

  const signResult = await hardwareWallet.signPSBT(txData.psbtBase64);
  if (signResult.psbt || signResult.rawTx) {
    await actions.broadcastTransaction(signResult.psbt, signResult.rawTx);
  }
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

async function signAndBroadcastTransaction(props: SendWizardActionHandlerProps) {
  const { actions } = props;

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

  if (await broadcastWithConnectedHardwareWallet(props, txData)) {
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
  hardwareWallet,
}: SendWizardActionHandlerProps) {

  const handleSignAndBroadcast = useCallback(async () => {
    await signAndBroadcastTransaction({ actions, hardwareWallet });
  }, [actions, hardwareWallet]);

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
