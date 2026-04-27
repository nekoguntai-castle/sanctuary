/**
 * Visual Settings Panel
 *
 * Dark mode toggle, background contrast slider, and pattern visibility slider.
 */

import React from 'react';
import { Contrast, Layers, PanelRight, type LucideIcon } from 'lucide-react';
import { Toggle } from '../../../../ui/Toggle';

interface VisualSettingsPanelProps {
  isDark: boolean;
  contrastLevel: number;
  patternOpacity: number;
  flyoutOpacity: number;
  onToggleDarkMode: () => void;
  onContrastChange: (level: number) => void;
  onPatternOpacityChange: (opacity: number) => void;
  onFlyoutOpacityChange: (opacity: number) => void;
}

interface SliderSettingProps {
  icon: LucideIcon;
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  isMono?: boolean;
  onChange: (value: number) => void;
}

const getContrastLabel = (level: number): string => {
  if (level === -2) return 'Much lighter';
  if (level === -1) return 'Lighter';
  if (level === 1) return 'Darker';
  if (level === 2) return 'Much darker';
  return 'Default';
};

const getPatternOpacityLabel = (opacity: number): string => {
  if (opacity === 0) return 'Hidden';
  if (opacity === 50) return 'Default';
  return `${opacity}%`;
};

const getFlyoutOpacityLabel = (opacity: number): string =>
  opacity === 100 ? 'Solid' : `${opacity}%`;

const SliderSetting: React.FC<SliderSettingProps> = ({
  icon: Icon,
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  isMono = false,
  onChange,
}) => (
  <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center space-x-2">
        <Icon className="w-4 h-4 text-sanctuary-500" />
        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{label}</span>
      </div>
      <span className={`text-xs text-sanctuary-500 ${isMono ? 'font-mono' : ''}`}>
        {valueLabel}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(parseInt(event.target.value, 10))}
      className="w-full h-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
    />
  </div>
);

export const VisualSettingsPanel: React.FC<VisualSettingsPanelProps> = ({
  isDark,
  contrastLevel,
  patternOpacity,
  flyoutOpacity,
  onToggleDarkMode,
  onContrastChange,
  onPatternOpacityChange,
  onFlyoutOpacityChange,
}) => {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Visual Settings</h3>
        <p className="text-sm text-sanctuary-500 mt-1">Adjust appearance settings</p>
      </div>
      <div className="p-6 space-y-6">
        {/* Dark Mode Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Dark Mode</span>
          <Toggle checked={isDark} onChange={onToggleDarkMode} />
        </div>

        <SliderSetting
          icon={Contrast}
          label="Background Contrast"
          valueLabel={getContrastLabel(contrastLevel)}
          value={contrastLevel}
          min={-2}
          max={2}
          step={1}
          onChange={onContrastChange}
        />

        <SliderSetting
          icon={Layers}
          label="Pattern Visibility"
          valueLabel={getPatternOpacityLabel(patternOpacity)}
          value={patternOpacity}
          min={0}
          max={100}
          step={5}
          isMono
          onChange={onPatternOpacityChange}
        />

        <SliderSetting
          icon={PanelRight}
          label="Flyout Opacity"
          valueLabel={getFlyoutOpacityLabel(flyoutOpacity)}
          value={flyoutOpacity}
          min={50}
          max={100}
          step={5}
          isMono
          onChange={onFlyoutOpacityChange}
        />
      </div>
    </div>
  );
};
