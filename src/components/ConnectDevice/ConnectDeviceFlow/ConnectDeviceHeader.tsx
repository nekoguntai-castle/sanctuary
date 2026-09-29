import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { secondaryActionClassName } from '../../ui/secondaryActionStyles';

interface ConnectDeviceHeaderProps {
  onBack: () => void;
  embedded?: boolean;
}

export const ConnectDeviceHeader: React.FC<ConnectDeviceHeaderProps> = ({ onBack, embedded = false }) => (
  <>
    <button
      type="button"
      onClick={onBack}
      className={`flex items-center ${secondaryActionClassName} hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors`}
    >
      <ArrowLeft className="w-4 h-4 mr-1" /> {embedded ? 'Return to Signers' : 'Back to Devices'}
    </button>

    <div>
      <h1 className="text-3xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Connect Hardware Device</h1>
      {embedded && <p className="text-sanctuary-700 dark:text-sanctuary-300">Creating a wallet · select signers after connecting</p>}
      <p className="text-sanctuary-500">Add a new signing device to your sanctuary.</p>
    </div>
  </>
);
