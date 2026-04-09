import React from 'react';

interface ErrorAlertProps {
  message: string | null;
  className?: string;
}

/**
 * Inline error alert for forms and modals.
 * Renders nothing when message is null/empty.
 */
export const ErrorAlert: React.FC<ErrorAlertProps> = ({ message, className = 'mb-4' }) => {
  if (!message) return null;

  return (
    <div className={`p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg text-sm text-rose-600 dark:text-rose-400 ${className}`}>
      {message}
    </div>
  );
};
