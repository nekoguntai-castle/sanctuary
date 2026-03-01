import React from 'react';
import { Search } from 'lucide-react';

interface FilterPanelProps {
  isOpen: boolean;
  filterUsername: string;
  filterCategory: string;
  filterAction: string;
  filterSuccess: string;
  onUsernameChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onActionChange: (value: string) => void;
  onSuccessChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

/**
 * Collapsible filter panel for filtering audit logs by username,
 * category, action, and success status.
 */
export const FilterPanel: React.FC<FilterPanelProps> = ({
  isOpen,
  filterUsername,
  filterCategory,
  filterAction,
  filterSuccess,
  onUsernameChange,
  onCategoryChange,
  onActionChange,
  onSuccessChange,
  onApply,
  onClear,
}) => {
  if (!isOpen) return null;

  return (
    <div className="surface-elevated rounded-xl p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
            Username
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400" />
            <input
              type="text"
              value={filterUsername}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder="Filter by username..."
              className="w-full pl-10 pr-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
            Category
          </label>
          <select
            value={filterCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
          >
            <option value="">All categories</option>
            <option value="auth">Authentication</option>
            <option value="user">User Management</option>
            <option value="wallet">Wallet</option>
            <option value="device">Device</option>
            <option value="admin">Admin</option>
            <option value="backup">Backup</option>
            <option value="system">System</option>
            <option value="gateway">Gateway (Mobile API)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
            Action
          </label>
          <input
            type="text"
            value={filterAction}
            onChange={(e) => onActionChange(e.target.value)}
            placeholder="Filter by action..."
            className="w-full px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
            Status
          </label>
          <select
            value={filterSuccess}
            onChange={(e) => onSuccessChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 text-sanctuary-900 dark:text-sanctuary-100"
          >
            <option value="">All</option>
            <option value="true">Success</option>
            <option value="false">Failed</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClear}
          className="px-4 py-2 text-sm rounded-lg text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
        >
          Clear
        </button>
        <button
          onClick={onApply}
          className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 transition-colors"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
};
