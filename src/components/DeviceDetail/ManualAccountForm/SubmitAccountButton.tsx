import React from 'react';
import { Loader2, Plus } from 'lucide-react';

interface SubmitAccountButtonProps {
  disabled: boolean;
  loading: boolean;
  onSubmit: () => void;
}

export const SubmitAccountButton: React.FC<SubmitAccountButtonProps> = ({
  disabled,
  loading,
  onSubmit,
}) => (
  <button
    onClick={onSubmit}
    disabled={disabled}
    className="w-full px-4 py-2.5 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
  >
    {loading ? (
      <>
        <Loader2 className="w-4 h-4 animate-spin" />
        Adding...
      </>
    ) : (
      <>
        <Plus className="w-4 h-4" />
        Add Account
      </>
    )}
  </button>
);
