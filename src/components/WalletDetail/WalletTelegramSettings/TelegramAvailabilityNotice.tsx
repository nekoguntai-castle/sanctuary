import { AlertCircle } from 'lucide-react';
import type { TelegramAvailability } from './types';

interface TelegramAvailabilityNoticeProps {
  availability: Exclude<TelegramAvailability, 'available'>;
}

const NOTICE_COPY: Record<TelegramAvailabilityNoticeProps['availability'], {
  title: string;
  body: string;
  className: string;
  iconClassName: string;
  titleClassName: string;
  bodyClassName: string;
}> = {
  'not-configured': {
    title: 'Telegram not configured',
    body: 'Configure your Telegram bot in Account Settings to receive notifications.',
    className: 'p-4 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-lg',
    iconClassName: 'w-5 h-5 text-warning-600 dark:text-warning-400 mt-0.5 flex-shrink-0',
    titleClassName: 'text-sm font-medium text-warning-700 dark:text-warning-300',
    bodyClassName: 'text-xs text-warning-600 dark:text-warning-400 mt-1',
  },
  disabled: {
    title: 'Telegram notifications disabled',
    body: 'Enable Telegram notifications globally in Account Settings first.',
    className: 'p-4 surface-secondary border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg',
    iconClassName: 'w-5 h-5 text-sanctuary-400 mt-0.5 flex-shrink-0',
    titleClassName: 'text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300',
    bodyClassName: 'text-xs text-sanctuary-500 mt-1',
  },
};

export function TelegramAvailabilityNotice({ availability }: TelegramAvailabilityNoticeProps) {
  const copy = NOTICE_COPY[availability];

  return (
    <div className={copy.className}>
      <div className="flex items-start space-x-3">
        <AlertCircle className={copy.iconClassName} />
        <div>
          <p className={copy.titleClassName}>{copy.title}</p>
          <p className={copy.bodyClassName}>{copy.body}</p>
        </div>
      </div>
    </div>
  );
}
