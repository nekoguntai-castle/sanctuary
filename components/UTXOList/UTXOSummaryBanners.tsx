import React from 'react';
import { AlertTriangle, Shield } from 'lucide-react';
import type { WalletPrivacySummary } from '../../src/api/transactions';

interface UTXOSummaryBannersProps {
  showPrivacy: boolean;
  privacySummary?: WalletPrivacySummary;
  dustCount: number;
  dustTotal: number;
  currentFeeRate: number;
  format: (sats: number) => string;
}

export const UTXOSummaryBanners: React.FC<UTXOSummaryBannersProps> = ({
  showPrivacy,
  privacySummary,
  dustCount,
  dustTotal,
  currentFeeRate,
  format,
}) => {
  return (
    <>
      {/* Privacy Summary */}
      {showPrivacy && privacySummary && (
        <div className="flex items-center gap-3 p-3 rounded-lg surface-secondary border border-sanctuary-200 dark:border-sanctuary-700">
          <Shield className="w-5 h-5 text-sanctuary-500 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">
                Wallet Privacy Score: {privacySummary.averageScore}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                privacySummary.grade === 'excellent' ? 'bg-zen-matcha/10 text-zen-matcha' :
                privacySummary.grade === 'good' ? 'bg-zen-indigo/10 text-zen-indigo' :
                privacySummary.grade === 'fair' ? 'bg-zen-gold/10 text-zen-gold' :
                'bg-zen-vermilion/10 text-zen-vermilion'
              }`}>
                {privacySummary.grade}
              </span>
            </div>
            {privacySummary.recommendations.length > 0 && (
              <p className="text-xs text-sanctuary-500 mt-0.5">
                {privacySummary.recommendations[0]}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Dust Warning Banner */}
      {dustCount > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              <span className="font-medium">{dustCount} dust UTXO{dustCount > 1 ? 's' : ''}</span>
              {' '}totaling <span className="font-mono">{format(dustTotal)}</span>
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              These outputs cost more to spend than they're worth at current fee rates ({currentFeeRate.toFixed(1)} sat/vB).
              Consider consolidating when fees are lower.
            </p>
          </div>
        </div>
      )}
    </>
  );
};
