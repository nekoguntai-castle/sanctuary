import React from 'react';
import { WalletDetailLoadedView } from './WalletDetailLoadedView';
import { ErrorState, LoadingState } from './WalletDetailStates';
import { useWalletDetailController } from './useWalletDetailController';

export const WalletDetail: React.FC = () => {
  const controller = useWalletDetailController();

  if (controller.loading) return <LoadingState />;

  if (controller.error) {
    return (
      <ErrorState
        error={controller.error}
        onRetry={() => { controller.setError(null); controller.fetchData(); }}
      />
    );
  }

  if (!controller.wallet) return <LoadingState />;

  return (
    <WalletDetailLoadedView
      controller={controller}
      wallet={controller.wallet}
    />
  );
};
