import React from 'react';
import {
  Shield,
  User,
  Wallet,
  Cpu,
  Settings,
  Database,
} from 'lucide-react';

// Category icon mapping
export const categoryIcons: Record<string, React.ReactNode> = {
  auth: React.createElement(Shield, { className: 'w-4 h-4' }),
  user: React.createElement(User, { className: 'w-4 h-4' }),
  wallet: React.createElement(Wallet, { className: 'w-4 h-4' }),
  device: React.createElement(Cpu, { className: 'w-4 h-4' }),
  admin: React.createElement(Settings, { className: 'w-4 h-4' }),
  backup: React.createElement(Database, { className: 'w-4 h-4' }),
  system: React.createElement(Settings, { className: 'w-4 h-4' }),
  gateway: React.createElement(Shield, { className: 'w-4 h-4' }),
};

// Category color classes
export const categoryColors: Record<string, string> = {
  auth: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  user: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  wallet: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  device: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  backup: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  system: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  gateway: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
};

// Format action name for display
export function formatAction(action: string): string {
  return action
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .join(' - ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Format relative time
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export const PAGE_SIZE = 25;
