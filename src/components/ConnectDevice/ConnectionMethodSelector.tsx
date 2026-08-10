/**
 * ConnectionMethodSelector Component
 *
 * Displays available connection methods for the selected device
 * with capability preview and method selection.
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { getDeviceIcon } from '../ui/CustomIcons';
import { connectivityConfig, isDeviceConnectivityMethod } from '../../utils/deviceConnection';
import type { ConnectionMethodSelectorProps } from './types';
import { renderCapabilities } from './DeviceModelSelector';

export const ConnectionMethodSelector: React.FC<ConnectionMethodSelectorProps> = ({
  selectedModel,
  selectedMethod,
  availableMethods,
  onSelectMethod,
}) => {
  return (
    <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
      <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">2. Connection Method</h3>

      {/* Untested Device Warning */}
      {!selectedModel.integrationTested && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-2 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Untested Device
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                This device has not been fully tested with Sanctuary. Supported USB, SD card, or QR imports may still encounter issues. Use at your own risk.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Device Capabilities Preview */}
      <div className="mb-4 p-3 surface-muted rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-3">
            {getDeviceIcon(selectedModel.name, "w-6 h-6")}
            <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{selectedModel.name}</span>
          </div>
          <div className="flex space-x-1">
            {selectedModel.connectivity.map(conn => {
              if (!isDeviceConnectivityMethod(conn)) return null;
              const config = connectivityConfig[conn];
              const Icon = config.icon;
              return (
                <span key={conn} className="p-1.5 bg-sanctuary-200 dark:bg-sanctuary-800 rounded" title={config.label}>
                  <Icon className="w-3.5 h-3.5 text-sanctuary-600 dark:text-sanctuary-400" />
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {renderCapabilities(selectedModel)}
        </div>
      </div>

      {/* Connection Method Selection */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {availableMethods.map((m) => {
          const config = isDeviceConnectivityMethod(m) ? connectivityConfig[m] : null;
          if (!config) return null;
          const Icon = config.icon;

          return (
            <button
              key={m}
              onClick={() => onSelectMethod(m)}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedMethod === m
                  ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500'
                  : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
              }`}
            >
              <Icon className="w-5 h-5 mb-2 text-sanctuary-600 dark:text-sanctuary-400" />
              <div className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100">{config.label}</div>
              <div className="text-xs text-sanctuary-500">{config.description}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
