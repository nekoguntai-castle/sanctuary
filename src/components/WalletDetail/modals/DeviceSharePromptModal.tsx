/**
 * DeviceSharePromptModal - Prompt to share signing devices after sharing a wallet
 *
 * Shown after a user is granted wallet access, offering to also share
 * the hardware signing devices associated with the wallet.
 */

import React from 'react';
import { HardDrive } from 'lucide-react';
import { Button } from '../../ui/Button';
import type { DeviceSharePromptState } from '../types';

interface DeviceSharePromptModalProps {
  deviceSharePrompt: DeviceSharePromptState;
  sharingLoading: boolean;
  onDismiss: () => void;
  onShareDevices: () => void;
}

export const DeviceSharePromptModal: React.FC<DeviceSharePromptModalProps> = ({
  deviceSharePrompt,
  sharingLoading,
  onDismiss,
  onShareDevices,
}) => {
  if (!deviceSharePrompt.show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="surface-elevated rounded-xl max-w-md w-full p-6 shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 animate-modal-enter">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-primary-100 dark:bg-primary-900/30 mb-4">
            <HardDrive className="h-6 w-6 text-primary-600 dark:text-primary-400" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">Share Devices?</h3>
          <p className="text-sm text-sanctuary-500 mb-4">
            <span className="font-medium text-sanctuary-700 dark:text-sanctuary-300">{deviceSharePrompt.targetUsername}</span> now has access to this wallet.
            Would you like to also share the following signing devices with them?
          </p>

          {/* Device List */}
          <div className="mb-6 space-y-2">
            {deviceSharePrompt.devices.map(device => (
              <div key={device.id} className="flex items-center justify-between p-3 surface-secondary rounded-lg text-left">
                <div className="flex items-center">
                  <div className="p-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg mr-3">
                    <HardDrive className="w-4 h-4 text-sanctuary-600 dark:text-sanctuary-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{device.label}</p>
                    <p className="text-xs text-sanctuary-500 font-mono">{device.fingerprint}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex space-x-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={onDismiss}
              disabled={sharingLoading}
            >
              Skip
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={onShareDevices}
              disabled={sharingLoading}
            >
              {sharingLoading ? 'Sharing...' : 'Share Devices'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
