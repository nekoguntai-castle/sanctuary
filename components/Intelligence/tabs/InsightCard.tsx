import React, { useState } from 'react';
import { AlertTriangle, Info, Shield, ChevronRight, ChevronDown, XCircle, Check } from 'lucide-react';
import type { AIInsight } from '../../../src/api/intelligence';

interface InsightCardProps {
  insight: AIInsight;
  onDismiss: () => void;
  onActedOn: () => void;
}

const TYPE_LABELS: Record<AIInsight['type'], string> = {
  utxo_health: 'UTXO Health',
  fee_timing: 'Fee Timing',
  anomaly: 'Anomaly',
  tax: 'Tax',
  consolidation: 'Consolidation',
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

const severityStyles: Record<
  AIInsight['severity'],
  { bg: string; border: string; icon: React.ElementType; iconColor: string; badgeBg: string; badgeText: string }
> = {
  critical: {
    bg: 'bg-rose-50 dark:bg-rose-900/20',
    border: 'border-rose-200 dark:border-rose-800/50',
    icon: Shield,
    iconColor: 'text-rose-600 dark:text-rose-400',
    badgeBg: 'bg-rose-100 dark:bg-rose-900/30',
    badgeText: 'text-rose-700 dark:text-rose-300',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800/50',
    icon: AlertTriangle,
    iconColor: 'text-amber-600 dark:text-amber-400',
    badgeBg: 'bg-amber-100 dark:bg-amber-900/30',
    badgeText: 'text-amber-700 dark:text-amber-300',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800/50',
    icon: Info,
    iconColor: 'text-blue-600 dark:text-blue-400',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/30',
    badgeText: 'text-blue-700 dark:text-blue-300',
  },
};

export const InsightCard: React.FC<InsightCardProps> = ({ insight, onDismiss, onActedOn }) => {
  const [expanded, setExpanded] = useState(false);
  const style = severityStyles[insight.severity];
  const SeverityIcon = style.icon;

  return (
    <div
      className={`rounded-xl border ${style.border} ${style.bg} transition-all`}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-start gap-2.5 p-3 text-left"
      >
        <SeverityIcon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${style.iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-sanctuary-800 dark:text-sanctuary-200">
              {insight.title}
            </span>
            <span
              className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium ${style.badgeBg} ${style.badgeText}`}
            >
              {TYPE_LABELS[insight.type]}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] leading-relaxed text-sanctuary-600 dark:text-sanctuary-400">
            {insight.summary}
          </p>
          <span className="mt-1 inline-block text-[9px] text-sanctuary-400 dark:text-sanctuary-500">
            {formatRelativeTime(insight.createdAt)}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sanctuary-400" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sanctuary-400" />
        )}
      </button>

      {/* Expanded analysis */}
      {expanded && (
        <div className="border-t border-sanctuary-200/50 px-3 pb-3 pt-2 dark:border-sanctuary-700/30">
          <p className="whitespace-pre-wrap text-[10px] leading-relaxed text-sanctuary-700 dark:text-sanctuary-300">
            {insight.analysis}
          </p>

          {/* Action buttons */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onActedOn();
              }}
              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-primary-700 dark:bg-primary-200 dark:text-primary-900 dark:hover:bg-primary-300"
            >
              <Check className="h-3 w-3" />
              Mark as acted on
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium text-sanctuary-500 transition-colors hover:bg-sanctuary-100 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:bg-sanctuary-800 dark:hover:text-sanctuary-200"
            >
              <XCircle className="h-3 w-3" />
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
