/**
 * Privacy Badge Component
 *
 * Displays a privacy score indicator for UTXOs.
 * Shows a color-coded shield icon based on privacy grade.
 */

import React from 'react';
import { Shield, ShieldAlert, ShieldCheck, ShieldX, type LucideIcon } from 'lucide-react';

type PrivacyGrade = 'excellent' | 'good' | 'fair' | 'poor';
type PrivacyBadgeSize = 'sm' | 'md' | 'lg';

interface PrivacyBadgeProps {
  score: number;
  grade: PrivacyGrade;
  size?: PrivacyBadgeSize;
  showScore?: boolean;
  className?: string;
  onClick?: () => void;
}

interface PrivacyGradeConfig {
  Icon: LucideIcon;
  color: string;
  bg: string;
  label: string;
}

const privacyBadgeSizeClasses: Record<PrivacyBadgeSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

const privacyGradeConfig: Record<PrivacyGrade, PrivacyGradeConfig> = {
  excellent: {
    Icon: ShieldCheck,
    color: 'text-zen-matcha',
    bg: 'bg-zen-matcha/10',
    label: 'Excellent Privacy',
  },
  good: {
    Icon: Shield,
    color: 'text-zen-indigo',
    bg: 'bg-zen-indigo/10',
    label: 'Good Privacy',
  },
  fair: {
    Icon: ShieldAlert,
    color: 'text-zen-gold',
    bg: 'bg-zen-gold/10',
    label: 'Fair Privacy',
  },
  poor: {
    Icon: ShieldX,
    color: 'text-zen-vermilion',
    bg: 'bg-zen-vermilion/10',
    label: 'Poor Privacy',
  },
};

const privacyScoreCardClasses: Record<PrivacyGrade, string> = {
  excellent: 'text-zen-matcha border-zen-matcha/30 bg-zen-matcha/5',
  good: 'text-zen-indigo border-zen-indigo/30 bg-zen-indigo/5',
  fair: 'text-zen-gold border-zen-gold/30 bg-zen-gold/5',
  poor: 'text-zen-vermilion border-zen-vermilion/30 bg-zen-vermilion/5',
};

function getPrivacyTitle(config: PrivacyGradeConfig, score: number, isClickable: boolean) {
  return `${config.label} (Score: ${score})${isClickable ? ' - Click for details' : ''}`;
}

function handlePrivacyBadgeKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  onClick: () => void
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onClick();
  }
}

function PrivacyBadgeIcon({
  config,
  size,
  isClickable,
}: {
  config: PrivacyGradeConfig;
  size: PrivacyBadgeSize;
  isClickable: boolean;
}) {
  const Icon = config.Icon;

  return (
    <span className={`${config.bg} ${config.color} p-0.5 rounded ${
      isClickable ? 'hover:ring-2 hover:ring-current/30 transition-all' : ''
    }`}>
      <Icon className={privacyBadgeSizeClasses[size]} />
    </span>
  );
}

export const PrivacyBadge: React.FC<PrivacyBadgeProps> = ({
  score,
  grade,
  size = 'sm',
  showScore = false,
  className = '',
  onClick,
}) => {
  const config = privacyGradeConfig[grade];
  const isClickable = !!onClick;

  return (
    <div
      className={`inline-flex items-center gap-1 ${className} ${
        isClickable
          ? 'cursor-pointer transition-transform hover:scale-110 active:scale-95'
          : ''
      }`}
      title={getPrivacyTitle(config, score, isClickable)}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable && onClick ? (event) => handlePrivacyBadgeKeyDown(event, onClick) : undefined}
    >
      <PrivacyBadgeIcon config={config} size={size} isClickable={isClickable} />
      {showScore && (
        <span className={`text-xs font-medium ${config.color}`}>
          {score}
        </span>
      )}
    </div>
  );
};

/**
 * Privacy Score Card
 * Detailed view of privacy factors
 */
interface PrivacyFactor {
  factor: string;
  impact: number;
  description: string;
}

interface PrivacyScoreCardProps {
  score: number;
  grade: PrivacyGrade;
  factors: PrivacyFactor[];
  warnings: string[];
}

function PrivacyFactorRows({ factors }: { factors: PrivacyFactor[] }) {
  if (factors.length === 0) return null;

  return (
    <div className="space-y-1 text-xs">
      {factors.map((factor, idx) => (
        <div key={idx} className="flex justify-between">
          <span className="opacity-80">{factor.factor}</span>
          <span className={factor.impact < 0 ? 'text-zen-vermilion' : 'text-zen-matcha'}>
            {factor.impact > 0 ? '+' : ''}{factor.impact}
          </span>
        </div>
      ))}
    </div>
  );
}

function PrivacyWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-current/20">
      {warnings.map((warning, idx) => (
        <p key={idx} className="text-xs opacity-80">
          {warning}
        </p>
      ))}
    </div>
  );
}

export const PrivacyScoreCard: React.FC<PrivacyScoreCardProps> = ({
  score,
  grade,
  factors,
  warnings,
}) => {
  return (
    <div className={`rounded-lg border p-3 ${privacyScoreCardClasses[grade]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium capitalize">{grade} Privacy</span>
        <span className="text-lg font-bold">{score}</span>
      </div>

      <PrivacyFactorRows factors={factors} />
      <PrivacyWarnings warnings={warnings} />
    </div>
  );
};

/**
 * Wallet Privacy Summary
 * Overview of wallet-wide privacy metrics
 */
interface WalletPrivacySummaryProps {
  averageScore: number;
  grade: PrivacyGrade;
  addressReuseCount: number;
  roundAmountCount: number;
  clusterCount: number;
  recommendations: string[];
}

function PrivacyMetricGrid({
  addressReuseCount,
  roundAmountCount,
  clusterCount,
}: Pick<WalletPrivacySummaryProps, 'addressReuseCount' | 'roundAmountCount' | 'clusterCount'>) {
  const metrics = [
    { label: 'Reused Addresses', value: addressReuseCount },
    { label: 'Round Amounts', value: roundAmountCount },
    { label: 'Linked Clusters', value: clusterCount },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 mb-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="text-center p-2 rounded bg-sanctuary-50 dark:bg-sanctuary-800/50">
          <div className="text-lg font-bold text-sanctuary-900 dark:text-sanctuary-100">
            {metric.value}
          </div>
          <div className="text-[10px] text-sanctuary-500">{metric.label}</div>
        </div>
      ))}
    </div>
  );
}

function PrivacyRecommendations({ recommendations }: { recommendations: string[] }) {
  if (recommendations.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-sanctuary-500 mb-1">Recommendations</div>
      {recommendations.map((rec, idx) => (
        <p key={idx} className="text-xs text-sanctuary-600 dark:text-sanctuary-400">
          {rec}
        </p>
      ))}
    </div>
  );
}

export const WalletPrivacySummary: React.FC<WalletPrivacySummaryProps> = ({
  averageScore,
  grade,
  addressReuseCount,
  roundAmountCount,
  clusterCount,
  recommendations,
}) => {
  return (
    <div className="surface-elevated rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
          Privacy Analysis
        </h4>
        <PrivacyBadge score={averageScore} grade={grade} size="md" showScore />
      </div>

      <PrivacyMetricGrid
        addressReuseCount={addressReuseCount}
        roundAmountCount={roundAmountCount}
        clusterCount={clusterCount}
      />
      <PrivacyRecommendations recommendations={recommendations} />
    </div>
  );
};
