import type { DisplayLogEntry } from './types';

export function getLogRowToneClass(level: string): string {
  if (level === 'error') {
    return 'bg-rose-50/50 dark:bg-rose-900/10';
  }

  if (level === 'warn') {
    return 'bg-warning-50/50 dark:bg-warning-900/10';
  }

  return '';
}

export function getLevelTextClass(level: string): string {
  if (level === 'debug') {
    return 'text-sanctuary-400';
  }

  if (level === 'info') {
    return 'text-success-600 dark:text-success-400';
  }

  if (level === 'warn') {
    return 'text-warning-600 dark:text-warning-400';
  }

  return 'text-rose-600 dark:text-rose-400';
}

export function getModuleBadgeClass(moduleName: string): string {
  if (moduleName === 'SYNC') {
    return 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300';
  }

  if (moduleName === 'BLOCKCHAIN') {
    return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300';
  }

  if (moduleName === 'TX') {
    return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300';
  }

  if (moduleName === 'UTXO') {
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300';
  }

  if (moduleName === 'ELECTRUM') {
    return 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300';
  }

  return 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400';
}

export function formatLogDetails(entry: DisplayLogEntry): string {
  if (!entry.details) {
    return '';
  }

  return Object.entries(entry.details)
    .filter(([key]) => key !== 'viaTor')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}
