import React from 'react';
import type { DeviceConflictResponse } from '../../../src/api/devices';
import { getDeviceIcon } from '../../ui/CustomIcons';
import { registeredAccountCount } from './formatters';

interface ExistingDeviceSummaryProps {
  device: DeviceConflictResponse['existingDevice'];
}

export const ExistingDeviceSummary: React.FC<ExistingDeviceSummaryProps> = ({ device }) => (
  <div className="p-3 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800 border border-sanctuary-200 dark:border-sanctuary-700 mb-4">
    <div className="flex items-center gap-2 mb-2">
      {getDeviceIcon(device.type, 'w-5 h-5')}
      <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{device.label}</span>
    </div>
    <div className="text-xs text-sanctuary-500">{registeredAccountCount(device.accounts.length)}</div>
  </div>
);
