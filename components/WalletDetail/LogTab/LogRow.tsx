import React from 'react';
import type { WalletLogEntry } from '../../../hooks/websocket';
import {
  formatLogDetails,
  getLevelTextClass,
  getLogRowToneClass,
  getModuleBadgeClass,
} from './logPresentation';
import type { DisplayLogEntry } from './types';

interface LogRowProps {
  entry: WalletLogEntry;
}

export const LogRow: React.FC<LogRowProps> = ({ entry }) => {
  const logEntry = entry as DisplayLogEntry;
  const level = logEntry.level;
  const moduleName = logEntry.module;
  const detailText = formatLogDetails(logEntry);

  return (
    <div
      className={`flex items-start py-1 px-2 rounded hover:bg-sanctuary-50 dark:hover:bg-sanctuary-900 ${getLogRowToneClass(level)}`}
    >
      <span className="text-sanctuary-400 flex-shrink-0 w-20">
        {new Date(logEntry.timestamp).toLocaleTimeString('en-US', { hour12: false })}
      </span>
      <span className={`flex-shrink-0 w-12 font-medium ${getLevelTextClass(level)}`}>
        {level.toUpperCase()}
      </span>
      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mr-2 ${getModuleBadgeClass(moduleName)}`}>
        {moduleName}
      </span>
      {Boolean(logEntry.details?.viaTor) && (
        <span
          className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mr-2 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
          title="Connection routed through Tor"
        >
          🧅 TOR
        </span>
      )}
      <span className="text-sanctuary-700 dark:text-sanctuary-300 flex-1 break-words">
        {logEntry.message}
        {logEntry.details && (
          <span className="text-sanctuary-400 ml-2">
            {detailText}
          </span>
        )}
      </span>
    </div>
  );
};
