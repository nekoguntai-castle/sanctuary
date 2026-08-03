import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  Settings2,
} from 'lucide-react';
import { AdvancedOptions } from '../../AdvancedOptions';

interface AdvancedOptionsPanelProps {
  expanded: boolean;
  rbfEnabled: boolean;
  useDecoys: boolean;
  subtractFees: boolean;
  decoyCount: number;
  onToggle: () => void;
  onRbfChange: (enabled: boolean) => void;
  onSubtractFeesChange: (enabled: boolean) => void;
  onDecoysChange: (enabled: boolean) => void;
  onDecoyCountChange: (count: number) => void;
}

export const AdvancedOptionsPanel: React.FC<AdvancedOptionsPanelProps> = ({
  expanded,
  rbfEnabled,
  useDecoys,
  subtractFees,
  decoyCount,
  onToggle,
  onRbfChange,
  onSubtractFeesChange,
  onDecoysChange,
  onDecoyCountChange,
}) => (
  <div className="surface-secondary rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full px-4 py-3 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-sanctuary-500" />
        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
          Advanced Options
        </span>
        {(rbfEnabled || useDecoys || subtractFees) && (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
            {[
              rbfEnabled && 'RBF',
              useDecoys && 'Decoys',
              subtractFees && 'Subtract',
            ].filter(Boolean).join(', ')}
          </span>
        )}
      </div>
      {expanded ? (
        <ChevronUp className="w-4 h-4 text-sanctuary-400" />
      ) : (
        <ChevronDown className="w-4 h-4 text-sanctuary-400" />
      )}
    </button>

    {expanded && (
      <div className="px-4 pb-4 border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
        <AdvancedOptions
          showAdvanced={true}
          setShowAdvanced={() => {}}
          enableRBF={rbfEnabled}
          setEnableRBF={onRbfChange}
          subtractFeesFromAmount={subtractFees}
          setSubtractFeesFromAmount={onSubtractFeesChange}
          enableDecoyOutputs={useDecoys}
          setEnableDecoyOutputs={onDecoysChange}
          decoyCount={decoyCount}
          setDecoyCount={onDecoyCountChange}
          disabled={false}
          hideHeader={true}
        />
      </div>
    )}
  </div>
);
