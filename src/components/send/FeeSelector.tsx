/**
 * FeeSelector Component
 *
 * Network fee selection panel including:
 * - Block visualizer for targeting confirmation speed
 * - Preset fee rate buttons (High Priority, Standard, Economy)
 * - Custom fee rate input
 *
 * Extracted from SendTransaction.tsx for maintainability.
 */

import { BlockVisualizer } from '../BlockVisualizer';
import type { FeeEstimate } from '../../types';
import type { BlockData, QueuedBlocksSummary } from '../../api/bitcoin';

export interface FeeSelectorProps {
  // Fee state
  feeRate: number;
  setFeeRate: (rate: number) => void;
  fees: FeeEstimate | null;

  // Block visualization
  mempoolBlocks: BlockData[];
  queuedBlocksSummary: QueuedBlocksSummary | null;

  // Disabled state (for draft resumption)
  disabled?: boolean;
}

interface FeePreset {
  label: string;
  rate: number | undefined;
  time: string;
}

export function FeeSelector({
  feeRate,
  setFeeRate,
  fees,
  mempoolBlocks,
  queuedBlocksSummary,
  disabled = false,
}: FeeSelectorProps) {
  const presets: FeePreset[] = [
    { label: 'High Priority', rate: fees?.fastestFee, time: '~10m' },
    { label: 'Standard', rate: fees?.halfHourFee, time: '~30m' },
    { label: 'Economy', rate: fees?.hourFee, time: '~1hr' },
  ];

  return (
    <div className={`space-y-4 ${disabled ? 'opacity-60' : ''}`}>
      <div>
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">Network Fee</h3>
        <p className="text-sm text-sanctuary-500 mb-4">
          {disabled ? 'Fee rate is locked for draft transactions.' : 'Click a block below to target its confirmation speed, or select a preset.'}
        </p>
        <div className={`surface-elevated rounded-lg border border-sanctuary-200 dark:border-sanctuary-800 p-2 mb-4 overflow-hidden ${disabled ? 'pointer-events-none' : ''}`}>
          <BlockVisualizer
            blocks={mempoolBlocks}
            queuedBlocksSummary={queuedBlocksSummary}
            onBlockClick={disabled ? undefined : (rate) => setFeeRate(rate)}
            compact={true}
          />
        </div>
      </div>

      <div className="surface-elevated p-3 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((opt) => (
            <button
              key={opt.label}
              onClick={() => !disabled && setFeeRate(opt.rate || 1)}
              className={`px-3 py-2 rounded-lg border transition-all text-left ${feeRate === opt.rate ? 'border-sanctuary-800 dark:border-sanctuary-200 bg-sanctuary-100 dark:bg-sanctuary-800' : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <div className="text-xs text-sanctuary-500">{opt.label}</div>
              <div className="text-sm font-semibold">{opt.rate} <span className="text-[10px] font-normal text-sanctuary-400">sat/vB</span></div>
            </button>
          ))}
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-xs text-sanctuary-500">Custom:</label>
            <input
              type="number"
              min={0.1}
              step={0.01}
              value={feeRate}
              onChange={(e) => !disabled && setFeeRate(parseFloat(e.target.value) || 0)}
              disabled={disabled}
              className={`w-20 px-2 py-1.5 text-sm rounded-md border border-sanctuary-300 dark:border-sanctuary-700 bg-transparent focus:ring-2 focus:ring-sanctuary-500 ${disabled ? 'cursor-not-allowed' : ''}`}
            />
            <span className="text-xs text-sanctuary-400">sat/vB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
