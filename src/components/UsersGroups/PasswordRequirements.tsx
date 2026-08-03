import React from 'react';
import { Check } from 'lucide-react';

interface PasswordRequirementsProps {
  password: string;
}

/**
 * Displays password validation requirements with check marks
 * for each satisfied condition.
 */
export const PasswordRequirements: React.FC<PasswordRequirementsProps> = ({ password }) => {
  return (
    <div className="mt-2 text-xs text-sanctuary-500 dark:text-sanctuary-400 space-y-0.5">
      <div className={password.length >= 8 ? 'text-green-600 dark:text-green-400' : ''}>
        <Check className={`w-3 h-3 inline mr-1 ${password.length >= 8 ? 'opacity-100' : 'opacity-0'}`} />
        At least 8 characters
      </div>
      <div className={/[A-Z]/.test(password) ? 'text-green-600 dark:text-green-400' : ''}>
        <Check className={`w-3 h-3 inline mr-1 ${/[A-Z]/.test(password) ? 'opacity-100' : 'opacity-0'}`} />
        One uppercase letter
      </div>
      <div className={/[a-z]/.test(password) ? 'text-green-600 dark:text-green-400' : ''}>
        <Check className={`w-3 h-3 inline mr-1 ${/[a-z]/.test(password) ? 'opacity-100' : 'opacity-0'}`} />
        One lowercase letter
      </div>
      <div className={/[0-9]/.test(password) ? 'text-green-600 dark:text-green-400' : ''}>
        <Check className={`w-3 h-3 inline mr-1 ${/[0-9]/.test(password) ? 'opacity-100' : 'opacity-0'}`} />
        One number
      </div>
    </div>
  );
};
