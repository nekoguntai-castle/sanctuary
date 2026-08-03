/**
 * Color Theme Panel
 *
 * Color theme selection grid.
 */

import React from 'react';
import type { ThemeOption } from '../../../../../types';

interface ThemeInfo {
  id: ThemeOption;
  name: string;
  color: string;
}

interface ColorThemePanelProps {
  themes: ThemeInfo[];
  currentTheme: string;
  onSelect: (theme: ThemeOption) => void;
}

export const ColorThemePanel: React.FC<ColorThemePanelProps> = ({
  themes,
  currentTheme,
  onSelect,
}) => {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Color Theme</h3>
        <p className="text-sm text-sanctuary-500 mt-1">Choose a color scheme for your wallet</p>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {themes.map(theme => (
            <button
              key={theme.id}
              onClick={() => onSelect(theme.id)}
              className={`
                relative rounded-lg border transition-all min-h-10 flex flex-col
                ${currentTheme === theme.id
                  ? 'border-primary-500 ring-1 ring-primary-500 dark:ring-primary-400'
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-primary-300'
                }
              `}
            >
              {/* Color bar at top */}
              <div className="h-1.5 w-full flex-shrink-0 rounded-t-lg" style={{ backgroundColor: theme.color }} />
              {/* Theme name */}
              <div className="px-1 py-0.5 flex-1 flex items-start justify-center">
                <span className={`text-[10px] font-medium leading-tight text-center ${currentTheme === theme.id ? 'text-primary-700 dark:text-primary-300' : 'text-sanctuary-600 dark:text-sanctuary-300'}`}>
                  {theme.name}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
