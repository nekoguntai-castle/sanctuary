import React from 'react';
import { SanctuaryLogo } from '../../ui/CustomIcons';

export const SidebarHeader: React.FC = () => (
  <div className="flex items-center h-20 flex-shrink-0 px-6 border-b border-sanctuary-200 dark:border-sanctuary-800">
    <SanctuaryLogo className="h-8 w-8 text-primary-700 dark:text-primary-500 mr-3" />
    <span className="text-xl font-semibold tracking-tight text-sanctuary-800 dark:text-sanctuary-200">
      Sanctuary
    </span>
  </div>
);
