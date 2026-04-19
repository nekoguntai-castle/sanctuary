import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Wallet } from '../../src/api/wallets';
import { useCurrency } from '../../contexts/CurrencyContext';
import { WalletGridCard } from './WalletGridCard';
import type { PendingData } from './types';

interface WalletGridViewProps {
  wallets: Wallet[];
  pendingByWallet: Record<string, PendingData>;
  sparklineData?: Record<string, number[]>;
}

/**
 * Renders wallets as a responsive grid of cards showing balance,
 * type, device count, sync status, and pending transaction indicators.
 */
export const WalletGridView: React.FC<WalletGridViewProps> = ({
  wallets,
  pendingByWallet,
  sparklineData = {},
}) => {
  const navigate = useNavigate();
  const { format, formatFiat, showFiat } = useCurrency();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {wallets.map(wallet => (
        <WalletGridCard
          key={wallet.id}
          wallet={wallet}
          pendingData={pendingByWallet[wallet.id]}
          sparklineValues={sparklineData[wallet.id]}
          format={format}
          formatFiat={formatFiat}
          showFiat={showFiat}
          onOpen={() => navigate(`/wallets/${wallet.id}`)}
        />
      ))}
    </div>
  );
};
