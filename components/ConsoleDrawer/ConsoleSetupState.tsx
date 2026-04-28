import React from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Settings } from 'lucide-react';
import type { ConsoleSetupReason } from '../../src/api/console';

interface ConsoleSetupStateProps {
  isAdmin?: boolean;
  reason: ConsoleSetupReason | null;
  onClose: () => void;
}

function setupCopy(reason: ConsoleSetupReason | null) {
  if (reason === 'feature-disabled') {
    return {
      title: 'Console feature disabled',
      body:
        'Sanctuary Console is disabled for this server. Enable the Sanctuary Console feature flag before using this surface.',
      linkLabel: 'Feature Flags',
      linkTo: '/admin/feature-flags',
    };
  }

  return {
    title: 'AI provider setup required',
    body:
      'Enable AI features and select a model in AI Settings before using Sanctuary Console.',
    linkLabel: 'AI Settings',
    linkTo: '/admin/ai',
  };
}

export const ConsoleSetupState: React.FC<ConsoleSetupStateProps> = ({
  isAdmin = false,
  reason,
  onClose,
}) => {
  const copy = setupCopy(reason);

  return (
    <div className="flex flex-1 items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <CircleAlert className="mx-auto h-9 w-9 text-warning-500" />
        <h3 className="mt-3 text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          {copy.title}
        </h3>
        <p className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
          {copy.body}
        </p>
        {isAdmin ? (
          <Link
            to={copy.linkTo}
            onClick={onClose}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-700 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 dark:bg-primary-300 dark:text-primary-950 dark:hover:bg-primary-200 focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Settings className="h-4 w-4" />
            {copy.linkLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
};
