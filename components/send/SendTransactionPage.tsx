/**
 * SendTransactionPage Component
 *
 * Page wrapper that handles data fetching and renders the SendTransactionWizard.
 * Replaces the monolithic SendTransaction.tsx with a cleaner separation of concerns.
 */

import { SendTransactionWizard } from './SendTransactionWizard';
import {
  SendTransactionErrorState,
  SendTransactionLoadingState,
} from './SendTransactionPage/SendTransactionPageStates';
import { useSendTransactionPageController } from './SendTransactionPage/useSendTransactionPageController';

export function SendTransactionPage() {
  const controller = useSendTransactionPageController();

  if (controller.loading) {
    return <SendTransactionLoadingState />;
  }

  if (controller.error || !controller.wallet) {
    return (
      <SendTransactionErrorState
        error={controller.error}
        onGoBack={() => controller.walletId && controller.handleCancel()}
      />
    );
  }

  return (
    <div className="p-6">
      <SendTransactionWizard
        wallet={controller.wallet}
        devices={controller.devices}
        utxos={controller.utxos}
        walletAddresses={controller.walletAddresses}
        fees={controller.fees}
        mempoolBlocks={controller.mempoolBlocks}
        queuedBlocksSummary={controller.queuedBlocksSummary}
        initialState={controller.initialState}
        draftTxData={controller.draftTxData}
        calculateFee={controller.calculateFee}
        onCancel={controller.handleCancel}
      />
    </div>
  );
}
