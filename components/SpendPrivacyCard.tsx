/**
 * Spend Privacy Card Component
 *
 * Shows aggregate privacy analysis when UTXOs are selected for spending.
 * Displays privacy score gauge, grade badge, linked addresses count, and top warnings.
 * Collapsible for detailed view.
 */

import React, { useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck, ShieldX, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { SpendPrivacyAnalysis } from '../src/api/transactions';
import {
  normalizePrivacyGrade,
  normalizePrivacyList,
  normalizePrivacyScore,
  type PrivacyGrade,
} from './privacyScoreUtils';

interface SpendPrivacyCardProps {
  analysis: SpendPrivacyAnalysis;
  className?: string;
}

const SpendPrivacyCard: React.FC<SpendPrivacyCardProps> = ({
  analysis,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const gradeConfig: Record<PrivacyGrade, {
    Icon: typeof Shield;
    color: string;
    bgColor: string;
    borderColor: string;
    label: string;
  }> = {
    excellent: {
      Icon: ShieldCheck,
      color: 'text-zen-matcha',
      bgColor: 'bg-zen-matcha/10',
      borderColor: 'border-zen-matcha/30',
      label: 'Excellent',
    },
    good: {
      Icon: Shield,
      color: 'text-zen-indigo',
      bgColor: 'bg-zen-indigo/10',
      borderColor: 'border-zen-indigo/30',
      label: 'Good',
    },
    fair: {
      Icon: ShieldAlert,
      color: 'text-zen-gold',
      bgColor: 'bg-zen-gold/10',
      borderColor: 'border-zen-gold/30',
      label: 'Fair',
    },
    poor: {
      Icon: ShieldX,
      color: 'text-zen-vermilion',
      bgColor: 'bg-zen-vermilion/10',
      borderColor: 'border-zen-vermilion/30',
      label: 'Poor',
    },
  };

  const normalizedGrade = normalizePrivacyGrade(analysis.grade);
  const normalizedScore = normalizePrivacyScore(analysis.score);
  const warnings = normalizePrivacyList<string>(analysis.warnings);
  const config = gradeConfig[normalizedGrade];
  const Icon = config.Icon;

  // Show top 3 warnings when collapsed, all when expanded
  const displayedWarnings = isExpanded ? warnings : warnings.slice(0, 3);

  return (
    <div
      className={`surface-elevated rounded-xl border-2 ${config.borderColor} ${config.bgColor} ${className} animate-fade-in`}
    >
      {/* Header */}
      <div className="p-4 border-b border-current/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.bgColor}`}>
              <Icon className={`w-5 h-5 ${config.color}`} />
            </div>
            <div>
              <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Privacy Impact
              </h4>
              <p className="text-xs text-sanctuary-500">
                Spending these UTXOs together
              </p>
            </div>
          </div>

          {/* Privacy Score Gauge */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className={`text-2xl font-bold ${config.color}`}>
                {normalizedScore}
              </div>
              <div className={`text-xs font-medium ${config.color} uppercase`}>
                {config.label}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="p-4 space-y-3">
        {/* Linked Addresses */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-sanctuary-600 dark:text-sanctuary-400">
            Linked Addresses
          </span>
          <span className={`font-medium ${config.color}`}>
            {analysis.linkedAddresses}
          </span>
        </div>

        {/* Warnings */}
        {displayedWarnings.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-medium text-sanctuary-600 dark:text-sanctuary-400 uppercase tracking-wide">
                Warnings
              </span>
            </div>
            <div className="space-y-1.5">
              {displayedWarnings.map((warning, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 text-xs text-sanctuary-700 dark:text-sanctuary-300"
                >
                  <span className="text-amber-500 mt-0.5">•</span>
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expand/Collapse Button */}
        {warnings.length > 3 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs font-medium text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                Show {warnings.length - 3} More
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default SpendPrivacyCard;
