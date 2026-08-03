import React from 'react';

interface NoticeAlertProps {
  message: string | null;
  className?: string;
  tone?: 'notice' | 'warning';
}

const TONE_CLASSES = {
  notice: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
} as const;

/**
 * Inline success/notice alert for forms and modals.
 * Renders nothing when message is null/empty.
 */
export const NoticeAlert: React.FC<NoticeAlertProps> = ({
  message,
  className = '',
  tone = 'notice',
}) => {
  if (!message) return null;

  return (
    <div className={`p-3 border rounded-lg text-sm ${TONE_CLASSES[tone]} ${className}`}>
      {message}
    </div>
  );
};
