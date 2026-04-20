import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../../ui/Button';

interface UsbErrorStateProps {
  visible: boolean;
  error: string | null;
  onConnect: () => void;
}

export const UsbErrorState: React.FC<UsbErrorStateProps> = ({ visible, error, onConnect }) => {
  if (!visible) {
    return null;
  }

  return (
    <>
      <div className="mx-auto text-rose-400 mb-3 flex justify-center">
        <AlertCircle className="w-12 h-12" />
      </div>
      <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">{error}</p>
      <Button onClick={onConnect}>Try Again</Button>
    </>
  );
};
