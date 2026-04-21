import React, { useState, useEffect } from 'react';
import { RefreshCw, Filter, AlertCircle } from 'lucide-react';
import {
  getAuditLogs,
  getAuditLogStats,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogStats,
} from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';
import { createLogger } from '../../utils/logger';
import { StatCards } from './StatCards';
import { FilterPanel } from './FilterPanel';
import { LogTable } from './LogTable';
import { LogDetailModal } from './LogDetailModal';
import { PAGE_SIZE } from './constants';

const log = createLogger('AuditLogs');

interface AuditLogFilterInputs {
  action: string;
  category: string;
  success: string;
  username: string;
}

function buildAuditLogQuery(filters: AuditLogQuery, currentPage: number): AuditLogQuery {
  return {
    ...filters,
    limit: PAGE_SIZE,
    offset: (currentPage - 1) * PAGE_SIZE,
  };
}

function buildAppliedFilters({
  action,
  category,
  success,
  username,
}: AuditLogFilterInputs): AuditLogQuery {
  const newFilters: AuditLogQuery = {};
  if (username) newFilters.username = username;
  if (category) newFilters.category = category;
  if (action) newFilters.action = action;
  if (success !== '') newFilters.success = success === 'true';
  return newFilters;
}

function countActiveFilters(filters: AuditLogQuery): number {
  return Object.keys(filters).length;
}

interface AuditLogsHeaderProps {
  activeFilterCount: number;
  loading: boolean;
  onRefresh: () => void;
  onToggleFilters: () => void;
  showFilters: boolean;
}

function AuditLogsHeader({
  activeFilterCount,
  loading,
  onRefresh,
  onToggleFilters,
  showFilters,
}: AuditLogsHeaderProps) {
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">
          Audit Logs
        </h2>
        <p className="text-sanctuary-500">
          Security and activity logs for the system
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleFilters}
          className={`flex items-center px-3 py-2 text-sm rounded-lg border transition-colors ${
            showFilters || hasActiveFilters
              ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400'
              : 'border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
          }`}
        >
          <Filter className="w-4 h-4 mr-2" />
          Filters
          {hasActiveFilters && (
            <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-primary-500 text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center px-3 py-2 text-sm rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
    </div>
  );
}

function AuditLogsError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center space-x-2">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm">{error}</span>
    </div>
  );
}

export const AuditLogs: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  // Filter state
  const [filters, setFilters] = useState<AuditLogQuery>({});
  const [filterUsername, setFilterUsername] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterSuccess, setFilterSuccess] = useState<string>('');

  // Loading state using hook
  const { loading, error, execute: runLoad } = useLoadingState({ initialLoading: true });

  const fetchLogs = () => runLoad(async () => {
    const result = await getAuditLogs(buildAuditLogQuery(filters, currentPage));
    setLogs(result.logs);
    setTotal(result.total);
  });

  const fetchStats = async () => {
    try {
      const result = await getAuditLogStats(30);
      setStats(result);
    } catch (err) {
      log.error('Failed to load audit stats', { error: err });
    }
  };

  useEffect(() => {
    void fetchLogs();
    void fetchStats();
  }, [currentPage, filters]);

  const applyFilters = () => {
    setFilters(buildAppliedFilters({
      action: filterAction,
      category: filterCategory,
      success: filterSuccess,
      username: filterUsername,
    }));
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilterUsername('');
    setFilterCategory('');
    setFilterAction('');
    setFilterSuccess('');
    setFilters({});
    setCurrentPage(1);
  };

  const activeFilterCount = countActiveFilters(filters);

  const handleRefresh = () => {
    void fetchLogs();
    void fetchStats();
  };

  return (
    <div className="space-y-6">
      <AuditLogsHeader
        activeFilterCount={activeFilterCount}
        loading={loading}
        onRefresh={handleRefresh}
        onToggleFilters={() => setShowFilters(!showFilters)}
        showFilters={showFilters}
      />

      {stats && <StatCards stats={stats} />}

      <FilterPanel
        isOpen={showFilters}
        filterUsername={filterUsername}
        filterCategory={filterCategory}
        filterAction={filterAction}
        filterSuccess={filterSuccess}
        onUsernameChange={setFilterUsername}
        onCategoryChange={setFilterCategory}
        onActionChange={setFilterAction}
        onSuccessChange={setFilterSuccess}
        onApply={applyFilters}
        onClear={clearFilters}
      />

      <AuditLogsError error={error} />

      <LogTable
        logs={logs}
        loading={loading}
        total={total}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={setCurrentPage}
        onSelectLog={setSelectedLog}
      />

      <LogDetailModal
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
      />
    </div>
  );
};
