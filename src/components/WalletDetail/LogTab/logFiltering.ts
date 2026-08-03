import type { WalletLogEntry } from '../../../hooks/websocket';
import type { LogLevelFilter } from './types';

const LOG_LEVEL_ORDER = ['debug', 'info', 'warn', 'error'];

export function filterLogsByLevel(logs: WalletLogEntry[], filter: LogLevelFilter): WalletLogEntry[] {
  if (filter === 'all') {
    return logs;
  }

  const filterLevel = LOG_LEVEL_ORDER.indexOf(filter);
  return logs.filter((entry) => LOG_LEVEL_ORDER.indexOf(entry.level) >= filterLevel);
}
