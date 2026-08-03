/**
 * DeviceModelSelector Component
 *
 * Displays a grid of hardware device models with search and manufacturer filtering.
 */

import React from 'react';
import { Search, X, Wifi, Shield, Code } from 'lucide-react';
import { HardwareDeviceModel } from '../../api/devices';
import { getDeviceIcon } from '../ui/CustomIcons';
import { DeviceModelSelectorProps } from './types';

/**
 * Render capability badges for a device model
 */
function renderCapabilities(model: HardwareDeviceModel) {
  const badges = [];

  if (model.airGapped) {
    badges.push(
      <span key="airgap" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <Wifi className="w-3 h-3 mr-1 line-through" /> Air-Gapped
      </span>
    );
  }
  if (model.secureElement) {
    badges.push(
      <span key="secure" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        <Shield className="w-3 h-3 mr-1" /> Secure Element
      </span>
    );
  }
  if (model.openSource) {
    badges.push(
      <span key="opensource" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
        <Code className="w-3 h-3 mr-1" /> Open Source
      </span>
    );
  }
  if (model.supportsBitcoinOnly) {
    badges.push(
      <span key="btconly" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Bitcoin Only
      </span>
    );
  }

  return badges;
}

export const DeviceModelSelector: React.FC<DeviceModelSelectorProps> = ({
  models,
  manufacturers,
  selectedModel,
  selectedManufacturer,
  searchQuery,
  onSelectModel,
  onSelectManufacturer,
  onSearchChange,
  onClearFilters,
}) => {
  return (
    <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-sanctuary-500 uppercase">1. Select Your Device</h3>
        <span className="text-xs text-sanctuary-400">{models.length} devices</span>
      </div>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search devices"
          placeholder="Search devices..."
          className="w-full pl-10 pr-10 py-2.5 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500 placeholder-sanctuary-400"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear device search"
            title="Clear device search"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-full transition-colors"
          >
            <X className="w-3 h-3 text-sanctuary-400" />
          </button>
        )}
      </div>

      {/* Manufacturer Filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => onSelectManufacturer(null)}
          aria-pressed={!selectedManufacturer}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            !selectedManufacturer
              ? 'bg-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900'
              : 'surface-secondary text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
          }`}
        >
          All
        </button>
        {manufacturers.map(mfr => (
          <button
            type="button"
            key={mfr}
            onClick={() => onSelectManufacturer(mfr)}
            aria-pressed={selectedManufacturer === mfr}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              selectedManufacturer === mfr
                ? 'bg-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900'
                : 'surface-secondary text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
            }`}
          >
            {mfr}
          </button>
        ))}
      </div>

      {/* Device Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-2 -mr-2">
        {models.length === 0 ? (
          <div className="col-span-full text-center py-8 text-sanctuary-400">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No devices match your search</p>
            <button
              onClick={onClearFilters}
              className="text-sm text-sanctuary-600 dark:text-sanctuary-300 hover:underline mt-2"
            >
              Clear filters
            </button>
          </div>
        ) : (
          models.map((model) => (
            <button
              type="button"
              key={model.id}
              onClick={() => onSelectModel(model)}
              aria-pressed={selectedModel?.id === model.id}
              className={`p-3 rounded-lg border text-left text-sm transition-all flex flex-col items-center justify-center space-y-2 py-4 relative ${
                selectedModel?.id === model.id
                  ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500'
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400 dark:hover:border-sanctuary-500'
              }`}
            >
              {!model.integrationTested && (
                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                  Untested
                </span>
              )}
              {getDeviceIcon(model.name, "w-8 h-8 opacity-80")}
              <div className="font-medium text-center text-sanctuary-900 dark:text-sanctuary-100 text-xs">{model.name}</div>
              <div className="text-[10px] text-sanctuary-500">{model.manufacturer}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export { renderCapabilities };
