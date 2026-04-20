import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface ConnectDeviceHeaderProps {
  onBack: () => void;
}

export const ConnectDeviceHeader: React.FC<ConnectDeviceHeaderProps> = ({ onBack }) => (
  <>
    <button
      onClick={onBack}
      className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
    >
      <ArrowLeft className="w-4 h-4 mr-1" /> Back to Devices
    </button>

    <div>
      <h1 className="text-3xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Connect Hardware Device</h1>
      <p className="text-sanctuary-500">Add a new signing device to your sanctuary.</p>
    </div>
  </>
);
