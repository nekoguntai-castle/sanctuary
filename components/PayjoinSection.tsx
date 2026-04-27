/**
 * PayjoinSection Component
 *
 * Minimal Payjoin toggle for the receive modal with progressive disclosure.
 * Default: Simple toggle with help icon
 * On demand: Tooltip explains what Payjoin is, "Learn more" opens education modal
 */

import React, { useState, useEffect, useRef } from 'react';
import { Shield, HelpCircle, X, AlertCircle, Check, Clock, Lock, ExternalLink } from 'lucide-react';
import type { PayjoinEligibility, PayjoinEligibilityStatus } from '../src/api/payjoin';
import { checkPayjoinEligibility } from '../src/api/payjoin';
import { PayjoinEducationModal } from './PayjoinEducationModal';

interface PayjoinSectionProps {
  walletId: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  className?: string;
}

// Status config for pills
const statusConfig: Record<PayjoinEligibilityStatus, {
  color: string;
  bgColor: string;
  icon: React.ElementType;
  label: string;
}> = {
  ready: {
    color: 'text-emerald-700 dark:text-emerald-300',
    bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
    icon: Check,
    label: 'Ready',
  },
  'no-utxos': {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: AlertCircle,
    label: 'No coins',
  },
  'pending-confirmations': {
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: Clock,
    label: 'Pending',
  },
  'all-frozen': {
    color: 'text-rose-700 dark:text-rose-300',
    bgColor: 'bg-rose-100 dark:bg-rose-900/30',
    icon: Lock,
    label: 'Frozen',
  },
  'all-locked': {
    color: 'text-cyan-700 dark:text-cyan-300',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/30',
    icon: Lock,
    label: 'Locked',
  },
  unavailable: {
    color: 'text-sanctuary-600 dark:text-sanctuary-400',
    bgColor: 'bg-sanctuary-100 dark:bg-sanctuary-800',
    icon: AlertCircle,
    label: 'Unavailable',
  },
};

type PayjoinStatusConfig = typeof statusConfig[PayjoinEligibilityStatus];

interface PayjoinMainRowProps {
  enabled: boolean;
  isEligible: boolean;
  showStatusPill: boolean;
  statusCfg: PayjoinStatusConfig;
  onToggle: (enabled: boolean) => void;
  onHelpClick: () => void;
}

interface PayjoinTooltipProps {
  tooltipRef: React.RefObject<HTMLDivElement | null>;
  eligibility: PayjoinEligibility | null;
  statusCfg: PayjoinStatusConfig;
  onClose: () => void;
  onLearnMore: () => void;
}

function useDismissTooltipOnOutsideClick(
  showTooltip: boolean,
  tooltipRef: React.RefObject<HTMLDivElement | null>,
  setShowTooltip: (showTooltip: boolean) => void
) {
  useEffect(() => {
    if (!showTooltip) {
      return undefined;
    }

    function handleClickOutside(event: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setShowTooltip(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTooltip, setShowTooltip, tooltipRef]);
}

function PayjoinMainRow({
  enabled,
  isEligible,
  showStatusPill,
  statusCfg,
  onToggle,
  onHelpClick,
}: PayjoinMainRowProps) {
  const StatusIcon = statusCfg.icon;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 surface-muted">
      <div className="flex items-center gap-2">
        <Shield className={`w-4 h-4 ${enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-sanctuary-400'}`} />
        <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
          Enhanced Privacy
        </span>

        <button
          type="button"
          onClick={onHelpClick}
          className="p-0.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors"
          aria-label="What is Payjoin?"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>

        {showStatusPill && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusCfg.bgColor} ${statusCfg.color}`}>
            <StatusIcon className="w-3 h-3" />
            {statusCfg.label}
          </span>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={!isEligible && !enabled}
        onClick={() => onToggle(!enabled)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          enabled
            ? 'bg-emerald-500 dark:bg-emerald-600'
            : isEligible
              ? 'bg-sanctuary-300 dark:bg-sanctuary-600'
              : 'bg-sanctuary-200 dark:bg-sanctuary-700 cursor-not-allowed'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
            enabled ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  );
}

function PayjoinTooltip({
  tooltipRef,
  eligibility,
  statusCfg,
  onClose,
  onLearnMore,
}: PayjoinTooltipProps) {
  return (
    <div
      ref={tooltipRef}
      className="absolute left-0 right-0 mt-2 p-4 rounded-lg surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg z-20"
    >
      <div className="flex items-start justify-between mb-3">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          What is Payjoin?
        </h4>
        <button
          onClick={onClose}
          className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-sanctuary-600 dark:text-sanctuary-400 mb-3">
        Payjoin adds your coins to the sender's transaction, making it harder for
        chain analysis to track. The sender's wallet must support Payjoin (BIP78).
      </p>

      <div className="text-xs text-sanctuary-500 dark:text-sanctuary-400 mb-3">
        <div className="font-medium mb-1">Requirements:</div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>At least one confirmed coin in this wallet</li>
          <li>Your server must stay online until payment arrives</li>
        </ul>
      </div>

      {eligibility?.reason && (
        <div className={`p-2 rounded-lg ${statusCfg.bgColor} mb-3`}>
          <p className={`text-xs ${statusCfg.color}`}>
            {eligibility.reason}
          </p>
        </div>
      )}

      <button
        onClick={onLearnMore}
        className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
      >
        Learn more about Payjoin
        <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );
}

export function PayjoinSection({ walletId, enabled, onToggle, className = '' }: PayjoinSectionProps) {
  const [eligibility, setEligibility] = useState<PayjoinEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showEducation, setShowEducation] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Fetch eligibility on mount
  useEffect(() => {
    const fetchEligibility = async () => {
      if (walletId) {
        setLoading(true);
        try {
          const result = await checkPayjoinEligibility(walletId);
          setEligibility(result);
        } catch {
          setEligibility(null);
        } finally {
          setLoading(false);
        }
      }
    };
    fetchEligibility();
  }, [walletId]);

  useDismissTooltipOnOutsideClick(showTooltip, tooltipRef, setShowTooltip);

  const isEligible = eligibility?.eligible ?? false;
  const status = eligibility?.status ?? 'unavailable';
  const statusCfg = statusConfig[status];

  // Only show status pill when there's a problem
  const showStatusPill = Boolean(!loading && !isEligible && eligibility);
  const handleHelpClick = () => setShowTooltip((current) => !current);
  const handleCloseTooltip = () => setShowTooltip(false);
  const handleLearnMore = () => {
    setShowTooltip(false);
    setShowEducation(true);
  };

  return (
    <div className={`relative ${className}`}>
      <PayjoinMainRow
        enabled={enabled}
        isEligible={isEligible}
        showStatusPill={showStatusPill}
        statusCfg={statusCfg}
        onToggle={onToggle}
        onHelpClick={handleHelpClick}
      />

      {showTooltip && (
        <PayjoinTooltip
          tooltipRef={tooltipRef}
          eligibility={eligibility}
          statusCfg={statusCfg}
          onClose={handleCloseTooltip}
          onLearnMore={handleLearnMore}
        />
      )}

      {enabled && (
        <p className="mt-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
          Keep your server running until payment arrives.
        </p>
      )}

      {showEducation && (
        <PayjoinEducationModal onClose={() => setShowEducation(false)} />
      )}
    </div>
  );
}

export default PayjoinSection;
