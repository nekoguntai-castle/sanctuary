/**
 * DeviceList Empty State
 *
 * Shown when no devices are connected.
 */

import React from 'react';
import { HardDrive, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { useNavigate } from 'react-router-dom';

export const EmptyState: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 animate-fade-in pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Hardware Devices</h2>
          <p className="text-sanctuary-500">Manage your signers and keys</p>
        </div>
      </div>

      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full surface-secondary mb-4">
          <HardDrive className="w-8 h-8 text-sanctuary-400" />
        </div>
        <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">No Devices Connected</h3>
        <p className="text-sanctuary-500 mb-6 max-w-md mx-auto">
          Connect your hardware wallet to start securing your Bitcoin. Sanctuary supports ColdCard, Ledger, Trezor, and many more.
        </p>
        <Button onClick={() => navigate('/devices/connect')}>
          <Plus className="w-4 h-4 mr-2" />
          Connect Your First Device
        </Button>
      </div>
    </div>
  );
};
