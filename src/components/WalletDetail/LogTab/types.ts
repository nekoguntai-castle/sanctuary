import type { WalletLogEntry } from '../../../hooks/websocket';

export type LogLevelFilter = 'all' | 'info' | 'warn' | 'error';

export type DisplayLogEntry = WalletLogEntry & {
  level: string;
  module: string;
};
