import React from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Settings } from 'lucide-react';

interface ConsoleSetupStateProps {
  isAdmin?: boolean;
  onClose: () => void;
}

export const ConsoleSetupState: React.FC<ConsoleSetupStateProps> = ({
  isAdmin = false,
  onClose,
}) => (
  <div className="flex flex-1 items-center justify-center px-8 text-center">
    <div className="max-w-sm">
      <CircleAlert className="mx-auto h-9 w-9 text-warning-500" />
      <h3 className="mt-3 text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100">
        Console setup required
      </h3>
      <p className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
        Enable the Console feature and configure a trusted model provider before
        using this surface.
      </p>
      {isAdmin ? (
        <Link
          to="/admin/ai"
          onClick={onClose}
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary-700 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 dark:bg-primary-300 dark:text-primary-950 dark:hover:bg-primary-200 focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Settings className="h-4 w-4" />
          AI Settings
        </Link>
      ) : null}
    </div>
  </div>
);
