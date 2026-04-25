/**
 * Privacy Detail Panel
 *
 * A slide-up bottom sheet panel that displays detailed privacy information
 * for a UTXO when users click on a privacy badge.
 */

import React, { useState, useEffect } from 'react';
import { X, Shield, AlertTriangle, ChevronDown, ChevronUp, Info, ExternalLink } from 'lucide-react';
import type { UtxoPrivacyInfo, PrivacyFactor } from '../src/api/transactions';
import { useCurrency } from '../contexts/CurrencyContext';
import {
  normalizePrivacyGrade,
  normalizePrivacyList,
  normalizePrivacyScore,
  type PrivacyGrade,
} from './privacyScoreUtils';

interface PrivacyDetailPanelProps {
  utxo: {
    txid: string;
    vout: number;
    amount: number;
    address: string;
  };
  privacyInfo: UtxoPrivacyInfo;
  onClose: () => void;
}

/**
 * Plain language mappings for privacy factors
 */
const FACTOR_DESCRIPTIONS: Record<string, { name: string; description: string }> = {
  addressReuse: {
    name: 'Same Address Used Again',
    description: 'This address has received bitcoin multiple times. Anyone can see these transactions are connected to the same owner.',
  },
  clusterSize: {
    name: 'Linked Outputs',
    description: 'This coin arrived with other coins in the same transaction. Observers know they belong to the same person.',
  },
  roundAmount: {
    name: 'Recognizable Amount',
    description: 'Round amounts like 0.5 or 1.0 BTC often come from exchanges or services, making the source easier to guess.',
  },
  timingCorrelation: {
    name: 'Same-Block Receives',
    description: 'You received multiple payments in the same block. This timing pattern could link them.',
  },
  smallUtxo: {
    name: 'Very Small Coin',
    description: 'This coin is much smaller than your typical holdings. Small outliers can stand out in chain analysis.',
  },
  largeUtxo: {
    name: 'Dominant Coin',
    description: 'This coin is much larger than your others. It will likely be included in most transactions, creating patterns.',
  },
};

/**
 * Get the grade label and color configuration
 */
function getGradeConfig(grade: PrivacyGrade) {
  const configs = {
    excellent: {
      label: 'Excellent',
      color: 'text-zen-matcha',
      bg: 'bg-zen-matcha/10',
      border: 'border-zen-matcha/30',
      progressColor: 'bg-zen-matcha',
    },
    good: {
      label: 'Good',
      color: 'text-zen-indigo',
      bg: 'bg-zen-indigo/10',
      border: 'border-zen-indigo/30',
      progressColor: 'bg-zen-indigo',
    },
    fair: {
      label: 'Fair',
      color: 'text-zen-gold',
      bg: 'bg-zen-gold/10',
      border: 'border-zen-gold/30',
      progressColor: 'bg-zen-gold',
    },
    poor: {
      label: 'Poor',
      color: 'text-zen-vermilion',
      bg: 'bg-zen-vermilion/10',
      border: 'border-zen-vermilion/30',
      progressColor: 'bg-zen-vermilion',
    },
  };
  return configs[grade];
}

/**
 * Privacy Score Gauge Component
 * Displays a horizontal progress bar showing the score position on a 0-100 scale
 */
function PrivacyScoreGauge({ score, grade }: { score: number; grade: PrivacyGrade }) {
  const config = getGradeConfig(grade);
  const normalizedScore = normalizePrivacyScore(score);

  return (
    <div className="w-full">
      {/* Scale markers */}
      <div className="flex justify-between text-[10px] text-sanctuary-400 mb-1">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>

      {/* Progress bar */}
      <div className="relative h-3 bg-sanctuary-100 dark:bg-sanctuary-800 rounded-full overflow-hidden">
        {/* Grade zone indicators */}
        <div className="absolute inset-0 flex">
          <div className="w-[40%] bg-zen-vermilion/20" />
          <div className="w-[20%] bg-zen-gold/20" />
          <div className="w-[20%] bg-zen-indigo/20" />
          <div className="w-[20%] bg-zen-matcha/20" />
        </div>

        {/* Score indicator */}
        <div
          className={`absolute top-0 bottom-0 ${config.progressColor} transition-all duration-500 ease-out rounded-full`}
          style={{ width: `${normalizedScore}%` }}
        />

        {/* Score position marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white dark:bg-sanctuary-900 border-2 shadow-sm transition-all duration-500 ease-out"
          style={{
            left: `calc(${normalizedScore}% - 8px)`,
            borderColor: 'currentColor',
          }}
        >
          <div className={`absolute inset-1 rounded-full ${config.progressColor}`} />
        </div>
      </div>

      {/* Grade labels */}
      <div className="flex justify-between text-[9px] mt-1">
        <span className="text-zen-vermilion">Poor</span>
        <span className="text-zen-gold">Fair</span>
        <span className="text-zen-indigo">Good</span>
        <span className="text-zen-matcha">Excellent</span>
      </div>
    </div>
  );
}

/**
 * Privacy Factor Row Component
 * Displays a single privacy factor with icon, name, impact, and description
 */
function PrivacyFactorRow({ factor }: { factor: PrivacyFactor }) {
  const mapping = FACTOR_DESCRIPTIONS[factor.factor] || {
    name: factor.factor,
    description: factor.description,
  };

  const isNegative = factor.impact < 0;

  return (
    <div className="py-3 border-b border-sanctuary-100 dark:border-sanctuary-800 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {isNegative && (
            <AlertTriangle className="w-4 h-4 text-zen-vermilion flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <span className="font-medium text-sanctuary-800 dark:text-sanctuary-200 text-sm">
              {mapping.name}
            </span>
          </div>
        </div>
        <span className={`text-sm font-mono font-medium flex-shrink-0 ${
          isNegative ? 'text-zen-vermilion' : 'text-zen-matcha'
        }`}>
          {factor.impact > 0 ? '+' : ''}{factor.impact}
        </span>
      </div>
      <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400 mt-1 leading-relaxed">
        {mapping.description}
      </p>
    </div>
  );
}

/**
 * Learn More Section Component
 * Expandable section with educational content about Bitcoin privacy
 */
function LearnMoreSection() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-t border-sanctuary-200 dark:border-sanctuary-700 pt-4 mt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-sm text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-800 dark:hover:text-sanctuary-200 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4" />
          <span>Learn more about Bitcoin privacy</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-3 text-sm text-sanctuary-600 dark:text-sanctuary-400 animate-fade-in">
          <p>
            <strong className="text-sanctuary-800 dark:text-sanctuary-200">Why privacy matters:</strong>{' '}
            Bitcoin transactions are public and permanent. Without proper privacy practices,
            anyone can analyze your transaction history, estimate your holdings, and track your spending.
          </p>

          <p>
            <strong className="text-sanctuary-800 dark:text-sanctuary-200">How scoring works:</strong>{' '}
            Each UTXO starts with a base score of 100. Points are deducted for privacy-reducing
            factors like address reuse, recognizable amounts, or timing patterns that could link
            your transactions together.
          </p>

          <p>
            <strong className="text-sanctuary-800 dark:text-sanctuary-200">Improving your score:</strong>{' '}
            Use fresh addresses for each receive, avoid round amounts when possible, and consider
            consolidating UTXOs during low-fee periods to reduce the number of inputs in future transactions.
          </p>

          <a
            href="https://bitcoin.org/en/protect-your-privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline"
          >
            Bitcoin.org Privacy Guide
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Main Privacy Detail Panel Component
 */
export function PrivacyDetailPanel({ utxo, privacyInfo, onClose }: PrivacyDetailPanelProps) {
  const { format } = useCurrency();
  const [isVisible, setIsVisible] = useState(false);

  const scoreData = privacyInfo?.score;
  const score = normalizePrivacyScore(scoreData?.score);
  const grade = normalizePrivacyGrade(scoreData?.grade);
  const factors = normalizePrivacyList<PrivacyFactor>(scoreData?.factors);
  const warnings = normalizePrivacyList<string>(scoreData?.warnings);
  const config = getGradeConfig(grade);

  // Animate in on mount
  useEffect(() => {
    // Small delay to trigger animation
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Handle close with animation
  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 200);
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Prevent body scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end md:items-center justify-center transition-colors duration-200 ${
        isVisible ? 'bg-black/50 backdrop-blur-sm' : 'bg-transparent'
      }`}
      onClick={handleBackdropClick}
    >
      {/* Panel - bottom sheet on mobile, centered modal on desktop */}
      <div
        className={`w-full max-w-lg surface-elevated shadow-2xl border-sanctuary-200 dark:border-sanctuary-700 transform transition-all duration-200 ease-out
          rounded-t-2xl border-t border-x md:rounded-xl md:border md:mx-4
          ${isVisible
            ? 'translate-y-0 md:translate-y-0 md:scale-100 md:opacity-100'
            : 'translate-y-full md:translate-y-0 md:scale-95 md:opacity-0'
          }`}
        style={{ maxHeight: '85vh' }}
      >
        {/* Drag handle - mobile only */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full bg-sanctuary-300 dark:bg-sanctuary-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 md:pt-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.bg}`}>
              <Shield className={`w-5 h-5 ${config.color}`} />
            </div>
            <div>
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Privacy Analysis
              </h3>
              <p className="text-xs text-sanctuary-500">
                {format(utxo.amount)} - {utxo.txid.substring(0, 8)}...:{utxo.vout}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg transition-colors"
            aria-label="Close panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 120px)' }}>
          {/* Score Display */}
          <div className={`p-4 rounded-lg ${config.bg} ${config.border} border mb-6`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className={`text-4xl font-bold ${config.color}`}>
                  {score}
                </span>
                <span className={`text-lg font-medium ${config.color} ml-2`}>
                  / 100
                </span>
              </div>
              <div className={`px-3 py-1 rounded-full ${config.bg} ${config.color} text-sm font-medium`}>
                {config.label}
              </div>
            </div>

            <PrivacyScoreGauge score={score} grade={grade} />
          </div>

          {/* Factors List */}
          {factors.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
                Factors Affecting Score
              </h4>
              <div className="surface-secondary rounded-lg p-4">
                {factors.map((factor, index) => (
                  <PrivacyFactorRow key={index} factor={factor} />
                ))}
              </div>
            </div>
          )}

          {/* No factors - perfect score */}
          {factors.length === 0 && (
            <div className="mb-4 p-4 rounded-lg bg-zen-matcha/10 border border-zen-matcha/20">
              <p className="text-sm text-zen-matcha">
                No privacy concerns detected for this UTXO. It has no known linkages or patterns
                that could reduce your privacy.
              </p>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
                Recommendations
              </h4>
              <div className="space-y-2">
                {warnings.map((warning, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800 dark:text-amber-300">{warning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Learn More Section */}
          <LearnMoreSection />
        </div>
      </div>
    </div>
  );
}
