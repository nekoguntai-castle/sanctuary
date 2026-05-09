import React from 'react';

interface NoticeAlertProps {
  message: string | null;
  className?: string;
}

/**
 * Inline success/notice alert for forms and modals.
 * Renders nothing when message is null/empty.
 */
export const NoticeAlert: React.FC<NoticeAlertProps> = ({ message, className = '' }) => {
  if (!message) return null;

  return (
    <div className={`p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-sm text-emerald-700 dark:text-emerald-300 ${className}`}>
      {message}
    </div>
  );
};
