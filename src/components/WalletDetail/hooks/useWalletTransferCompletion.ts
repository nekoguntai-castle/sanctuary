import type { NavigateFunction } from 'react-router-dom';
import { walletKeys } from '../../../hooks/queries/useWallets';
import { getQueryClient } from '../../../providers/QueryProvider';
import { removeTransferredResourceAccess } from '../../PendingTransfersPanel/transferAccessCache';
import type { TransferCompletionCallback } from '../../PendingTransfersPanel/transferCompletion';
import { useWalletRouteOwnership } from './useWalletRouteOwnership';

interface WalletTransferCompletionParams {
  walletId: string | undefined;
  ownershipKey: string;
  navigate: NavigateFunction;
  refreshAfterConfirmedTransfer: TransferCompletionCallback;
}

/** Reconcile confirmed access loss, then navigate only if this route still owns the result. */
export function useWalletTransferCompletion({
  walletId,
  ownershipKey,
  navigate,
  refreshAfterConfirmedTransfer,
}: WalletTransferCompletionParams): TransferCompletionCallback {
  const queryClient = getQueryClient();
  const ownership = useWalletRouteOwnership(ownershipKey);

  return async () => {
    if (!walletId) return { status: 'superseded' };
    const initiatingWalletId = walletId;
    const token = ownership.captureRoute(ownershipKey);
    const result = await refreshAfterConfirmedTransfer();
    if (result.status !== 'access-removed') return result;

    await removeTransferredResourceAccess(
      queryClient,
      initiatingWalletId,
      walletKeys.lists(),
      walletKeys.detail(initiatingWalletId),
    );
    if (!ownership.isRouteOwner(token)) return { status: 'superseded' };
    navigate('/wallets', { replace: true });
    return result;
  };
}
