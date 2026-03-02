/**
 * Visual Settings Panel
 *
 * Dark mode toggle, background contrast slider, and pattern visibility slider.
 */

import React from 'react';
import { Contrast, Layers } from 'lucide-react';

interface VisualSettingsPanelProps {
  isDark: boolean;
  contrastLevel: number;
  patternOpacity: number;
  onToggleDarkMode: () => void;
  onContrastChange: (level: number) => void;
  onPatternOpacityChange: (opacity: number) => void;
}

export const VisualSettingsPanel: React.FC<VisualSettingsPanelProps> = ({
  isDark,
  contrastLevel,
  patternOpacity,
  onToggleDarkMode,
  onContrastChange,
  onPatternOpacityChange,
}) => {
  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Visual Settings</h3>
        <p className="text-sm text-sanctuary-500 mt-1">Adjust appearance settings</p>
      </div>
      <div className="p-6 space-y-6">
        {/* Dark Mode Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Dark Mode</span>
          <button
            onClick={onToggleDarkMode}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${isDark ? 'bg-primary-600' : 'bg-sanctuary-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${isDark ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Background Contrast */}
        <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Contrast className="w-4 h-4 text-sanctuary-500" />
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Background Contrast</span>
            </div>
            <span className="text-xs text-sanctuary-500">
              {(() => {
                if (contrastLevel === 0) return 'Default';
                if (contrastLevel === -2) return 'Much lighter';
                if (contrastLevel === -1) return 'Lighter';
                if (contrastLevel === 1) return 'Darker';
                if (contrastLevel === 2) return 'Much darker';
                return 'Default';
              })()}
            </span>
          </div>
          <input
            type="range"
            min="-2"
            max="2"
            step="1"
            value={contrastLevel}
            onChange={(e) => onContrastChange(parseInt(e.target.value, 10))}
            className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
          />
        </div>

        {/* Pattern Visibility */}
        <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-sanctuary-500" />
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Pattern Visibility</span>
            </div>
            <span className="text-xs text-sanctuary-500 font-mono">
              {patternOpacity === 0
                ? 'Hidden'
                : patternOpacity === 50
                ? 'Default'
                : `${patternOpacity}%`}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={patternOpacity}
            onChange={(e) => onPatternOpacityChange(parseInt(e.target.value, 10))}
            className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
          />
        </div>
      </div>
    </div>
  );
};
