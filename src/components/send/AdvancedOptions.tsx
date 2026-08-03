/**
 * AdvancedOptions Component
 *
 * Transaction advanced options panel including:
 * - RBF (Replace-by-Fee) toggle
 * - Subtract fees from amount toggle
 * - Stonewall-like decoy outputs settings
 *
 * Extracted from SendTransaction.tsx for maintainability.
 */

import { Sliders, ChevronDown } from 'lucide-react';

export interface AdvancedOptionsProps {
  // Visibility
  showAdvanced: boolean;
  setShowAdvanced: (show: boolean) => void;

  // RBF
  enableRBF: boolean;
  setEnableRBF: (enabled: boolean) => void;

  // Subtract fees
  subtractFeesFromAmount: boolean;
  setSubtractFeesFromAmount: (enabled: boolean) => void;

  // Decoy outputs
  enableDecoyOutputs: boolean;
  setEnableDecoyOutputs: (enabled: boolean) => void;
  decoyCount: number;
  setDecoyCount: (count: number) => void;

  // Disabled state (for draft resumption)
  disabled?: boolean;

  // Skip rendering the header/toggle button (for when parent handles expand/collapse)
  hideHeader?: boolean;
}

// Shared options content - used by both rendering modes
interface OptionsContentProps {
  enableRBF: boolean;
  setEnableRBF: (enabled: boolean) => void;
  subtractFeesFromAmount: boolean;
  setSubtractFeesFromAmount: (enabled: boolean) => void;
  enableDecoyOutputs: boolean;
  setEnableDecoyOutputs: (enabled: boolean) => void;
  decoyCount: number;
  setDecoyCount: (count: number) => void;
  disabled: boolean;
}

function OptionsContent({
  enableRBF,
  setEnableRBF,
  subtractFeesFromAmount,
  setSubtractFeesFromAmount,
  enableDecoyOutputs,
  setEnableDecoyOutputs,
  decoyCount,
  setDecoyCount,
  disabled,
}: OptionsContentProps) {
  return (
    <>
      {/* RBF Toggle */}
      <label className={`flex items-center space-x-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={enableRBF}
          onChange={(e) => !disabled && setEnableRBF(e.target.checked)}
          disabled={disabled}
          className="w-4 h-4 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
        />
        <div>
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Enable RBF</span>
          <p className="text-xs text-sanctuary-500">Replace-by-Fee allows you to bump the fee later if the transaction is stuck</p>
        </div>
      </label>

      {/* Subtract Fees Toggle */}
      <label className={`flex items-center space-x-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={subtractFeesFromAmount}
          onChange={(e) => !disabled && setSubtractFeesFromAmount(e.target.checked)}
          disabled={disabled}
          className="w-4 h-4 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
        />
        <div>
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Subtract fees from amount</span>
          <p className="text-xs text-sanctuary-500">Deduct network fees from the amount sent instead of adding to total</p>
        </div>
      </label>

      {/* Decoy Outputs */}
      <div className={`space-y-2 ${disabled ? 'opacity-60' : ''}`}>
        <label className={`flex items-center space-x-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={enableDecoyOutputs}
            onChange={(e) => !disabled && setEnableDecoyOutputs(e.target.checked)}
            disabled={disabled}
            className="w-4 h-4 rounded border-sanctuary-300 dark:border-sanctuary-600 text-primary-600 focus:ring-primary-500 surface-secondary"
          />
          <div>
            <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Stonewall-like Decoy Outputs</span>
            <p className="text-xs text-sanctuary-500">Split change into multiple outputs to confuse chain analysis</p>
          </div>
        </label>
        {enableDecoyOutputs && (
          <div className="ml-7 flex items-center gap-2">
            <span className="text-xs text-sanctuary-500">Number of outputs:</span>
            <select
              value={decoyCount}
              onChange={(e) => setDecoyCount(Number(e.target.value))}
              disabled={disabled}
              className="text-sm px-2 py-1 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 surface-secondary text-sanctuary-900 dark:text-sanctuary-100"
            >
              <option value={2}>2 outputs</option>
              <option value={3}>3 outputs</option>
              <option value={4}>4 outputs</option>
            </select>
            <span className="text-xs text-amber-600 dark:text-amber-400">+~{(decoyCount - 1) * 34} vBytes</span>
          </div>
        )}
      </div>
    </>
  );
}

export function AdvancedOptions({
  showAdvanced,
  setShowAdvanced,
  enableRBF,
  setEnableRBF,
  subtractFeesFromAmount,
  setSubtractFeesFromAmount,
  enableDecoyOutputs,
  setEnableDecoyOutputs,
  decoyCount,
  setDecoyCount,
  disabled = false,
  hideHeader = false,
}: AdvancedOptionsProps) {
  const contentProps = {
    enableRBF,
    setEnableRBF,
    subtractFeesFromAmount,
    setSubtractFeesFromAmount,
    enableDecoyOutputs,
    setEnableDecoyOutputs,
    decoyCount,
    setDecoyCount,
    disabled,
  };

  // If hideHeader is true, just render the options content without wrapper
  if (hideHeader) {
    return (
      <div className="space-y-3">
        <OptionsContent {...contentProps} />
      </div>
    );
  }

  return (
    <div className="border-t border-sanctuary-200 dark:border-sanctuary-800 pt-4">
      <button
        type="button"
        onClick={() => !disabled && setShowAdvanced(!showAdvanced)}
        disabled={disabled}
        className={`flex items-center text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200 transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <Sliders className="w-4 h-4 mr-2" />
        Advanced Options
        <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
      </button>

      {showAdvanced && (
        <div className="mt-4 space-y-3 pl-6">
          <OptionsContent {...contentProps} />
        </div>
      )}
    </div>
  );
}
