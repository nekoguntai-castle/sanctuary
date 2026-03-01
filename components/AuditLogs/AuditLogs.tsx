import React, { useState, useEffect } from 'react';
import { RefreshCw, Filter } from 'lucide-react';
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
    const query: AuditLogQuery = {
      ...filters,
      limit: PAGE_SIZE,
      offset: (currentPage - 1) * PAGE_SIZE,
    };
    const result = await getAuditLogs(query);
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
    fetchLogs();
    fetchStats();
  }, [currentPage, filters]);

  const applyFilters = () => {
    const newFilters: AuditLogQuery = {};
    if (filterUsername) newFilters.username = filterUsername;
    if (filterCategory) newFilters.category = filterCategory;
    if (filterAction) newFilters.action = filterAction;
    if (filterSuccess !== '') newFilters.success = filterSuccess === 'true';
    setFilters(newFilters);
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

  const hasActiveFilters = Object.keys(filters).length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
            Audit Logs
          </h1>
          <p className="text-sanctuary-500 dark:text-sanctuary-400 mt-1">
            Security and activity logs for the system
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
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
                {Object.keys(filters).length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              fetchLogs();
              fetchStats();
            }}
            disabled={loading}
            className="flex items-center px-3 py-2 text-sm rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && <StatCards stats={stats} />}

      {/* Filters Panel */}
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

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Logs Table */}
      <LogTable
        logs={logs}
        loading={loading}
        total={total}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={setCurrentPage}
        onSelectLog={setSelectedLog}
      />

      {/* Detail Modal */}
      <LogDetailModal
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
      />
    </div>
  );
};
