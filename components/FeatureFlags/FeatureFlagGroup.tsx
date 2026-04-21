import { Check, Info, RotateCcw } from 'lucide-react';
import type { FeatureFlagInfo } from '../../src/api/admin';
import { Toggle } from '../ui/Toggle';

interface FeatureFlagGroupProps {
  categoryFlags: FeatureFlagInfo[];
  onReset: (flag: FeatureFlagInfo) => void;
  onToggle: (flag: FeatureFlagInfo) => void;
  resettingKey: string | null;
  saveSuccess: string | null;
  title: string;
  togglingKey: string | null;
}

function FeatureFlagRow({
  flag,
  onReset,
  onToggle,
  resettingKey,
  saveSuccess,
  togglingKey,
}: {
  flag: FeatureFlagInfo;
  onReset: (flag: FeatureFlagInfo) => void;
  onToggle: (flag: FeatureFlagInfo) => void;
  resettingKey: string | null;
  saveSuccess: string | null;
  togglingKey: string | null;
}) {
  const isBusy = resettingKey === flag.key || togglingKey === flag.key;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-start space-x-3 flex-1 min-w-0">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 font-mono">
                {flag.key}
              </span>
              {saveSuccess === flag.key && (
                <span className="flex items-center space-x-1 text-success-600 dark:text-success-400">
                  <Check className="w-3 h-3" />
                  <span className="text-[11px]">Saved</span>
                </span>
              )}
            </div>
            <p className="text-sm text-sanctuary-500">{flag.description}</p>
            {flag.modifiedBy && flag.modifiedBy !== 'system' && (
              <p className="text-[11px] text-sanctuary-400">
                Modified by {flag.modifiedBy}
                {flag.updatedAt && ` on ${new Date(flag.updatedAt).toLocaleDateString()}`}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2 ml-4">
          <button
            onClick={() => onReset(flag)}
            disabled={isBusy}
            className="p-1.5 rounded-lg text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Reset to environment default"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resettingKey === flag.key ? 'animate-spin' : ''}`} />
          </button>

          <Toggle
            checked={flag.enabled}
            onChange={() => onToggle(flag)}
            disabled={isBusy}
          />
        </div>
      </div>

      {flag.hasSideEffects && (
        <div className="mt-2 flex items-start space-x-2 p-2 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="text-[11px]">
            {flag.sideEffectDescription || 'Toggling this flag has immediate runtime side effects.'}
          </span>
        </div>
      )}
    </div>
  );
}

export function FeatureFlagGroup({
  categoryFlags,
  onReset,
  onToggle,
  resettingKey,
  saveSuccess,
  title,
  togglingKey,
}: FeatureFlagGroupProps) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
          {title}
        </h3>
      </div>

      <div className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
        {categoryFlags.map((flag) => (
          <FeatureFlagRow
            key={flag.key}
            flag={flag}
            onReset={onReset}
            onToggle={onToggle}
            resettingKey={resettingKey}
            saveSuccess={saveSuccess}
            togglingKey={togglingKey}
          />
        ))}
      </div>
    </div>
  );
}
