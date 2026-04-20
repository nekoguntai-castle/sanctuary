import React from 'react';
import { LogOut, Moon, Sun } from 'lucide-react';
import { version } from '../../../package.json';
import { NotificationBell } from '../../NotificationPanel';
import { BlockHeightIndicator } from '../BlockHeightIndicator';

interface SidebarFooterProps {
  user: { username: string; isAdmin?: boolean } | null;
  darkMode: boolean;
  toggleTheme: () => void;
  logout: () => void;
  onVersionClick: () => void;
}

export const SidebarFooter: React.FC<SidebarFooterProps> = ({
  user,
  darkMode,
  toggleTheme,
  logout,
  onVersionClick,
}) => (
  <div className="flex-shrink-0 border-t border-sanctuary-200 dark:border-sanctuary-800">
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-primary-100 dark:bg-sanctuary-800 flex items-center justify-center text-xs font-semibold text-primary-700 dark:text-primary-400 uppercase">
          {user?.username?.charAt(0) || '?'}
        </div>
        <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
          {user?.username}
        </span>
      </div>
      <button
        onClick={logout}
        className="p-1.5 rounded-lg text-sanctuary-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 transition-colors"
        title="Logout"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>

    <div className="flex items-center justify-between px-4 py-2">
      <div className="flex items-center gap-0.5">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <Sun className="h-4 w-4 theme-toggle-icon" />
          ) : (
            <Moon className="h-4 w-4 theme-toggle-icon" />
          )}
        </button>
        <NotificationBell />
      </div>
      <div className="flex items-center gap-3">
        <BlockHeightIndicator />
        <button
          onClick={onVersionClick}
          className="text-[11px] text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors cursor-pointer"
          title="Version info & support"
        >
          v{version}
        </button>
      </div>
    </div>
  </div>
);
