import React from 'react';
import { ScrollText } from 'lucide-react';
import type { WalletLogEntry } from '../../../hooks/websocket';
import { LogRow } from './LogRow';

interface LogContentProps {
  isLoading: boolean;
  logsCount: number;
  filteredLogs: WalletLogEntry[];
  onScroll: React.UIEventHandler<HTMLDivElement>;
}

export const LogContent = React.forwardRef<HTMLDivElement, LogContentProps>(
  ({ isLoading, logsCount, filteredLogs, onScroll }, ref) => (
    <div
      ref={ref}
      className="h-[500px] overflow-y-auto font-mono text-xs"
      onScroll={onScroll}
    >
      {isLoading ? (
        <LogLoadingState />
      ) : logsCount === 0 ? (
        <LogEmptyState />
      ) : (
        <LogList logs={filteredLogs} />
      )}
    </div>
  )
);

LogContent.displayName = 'LogContent';

const LogLoadingState: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full text-sanctuary-400">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mb-3" />
    <p className="text-sm">Loading logs...</p>
  </div>
);

const LogEmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full text-sanctuary-400">
    <ScrollText className="w-12 h-12 mb-3 opacity-30" />
    <p className="text-sm">No log entries yet</p>
    <p className="text-xs mt-1">Trigger a sync to see real-time logs</p>
  </div>
);

const LogList: React.FC<{ logs: WalletLogEntry[] }> = ({ logs }) => (
  <div className="p-2">
    {logs.map((entry) => (
      <LogRow key={entry.id} entry={entry} />
    ))}
  </div>
);
