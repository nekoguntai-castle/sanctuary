import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface LayoutNoticeProps {
  icon: LucideIcon;
  role?: 'status' | 'alert';
  children: React.ReactNode;
}

/** Full-width amber strip at the top of the main content area for app-wide notices. */
export const LayoutNotice: React.FC<LayoutNoticeProps> = ({ icon: Icon, role, children }) => (
  <div role={role} className="bg-amber-500 dark:bg-amber-600">
    <div className="max-w-7xl mx-auto py-2 px-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between flex-wrap">
        <div className="flex-1 flex items-center">
          <span className="flex p-1 rounded-lg bg-amber-600 dark:bg-amber-700">
            <Icon className="h-5 w-5 text-white" />
          </span>
          <p className="ml-3 font-medium text-white text-sm">{children}</p>
        </div>
      </div>
    </div>
  </div>
);
