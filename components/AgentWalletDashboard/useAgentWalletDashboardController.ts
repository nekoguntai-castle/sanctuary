import { useCallback, useEffect, useMemo, useState } from 'react';
import * as adminApi from '../../src/api/admin';
import type { AgentWalletDashboardRow } from '../../src/api/admin';
import { extractErrorMessage } from '../../utils/errorHandler';
import {
  buildDashboardTotals,
  orderAgentWalletRows,
} from './agentWalletDashboardModel';

export function useAgentWalletDashboardController() {
  const [rows, setRows] = useState<AgentWalletDashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const dashboardRows = await adminApi.getAgentWalletDashboard();
      setRows(dashboardRows);
    } catch (error) {
      setLoadError(extractErrorMessage(error, 'Failed to load agent wallets'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const orderedRows = useMemo(() => orderAgentWalletRows(rows), [rows]);
  const totals = useMemo(() => buildDashboardTotals(rows), [rows]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusyAction(key);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(extractErrorMessage(error, 'Agent wallet action failed'));
    } finally {
      setBusyAction(null);
    }
  }, []);

  const handleStatusChange = useCallback(async (row: AgentWalletDashboardRow, status: 'active' | 'paused') => {
    await runAction(`status-${row.agent.id}`, async () => {
      await adminApi.updateWalletAgent(row.agent.id, { status });
      await loadData();
    });
  }, [loadData, runAction]);

  const handleRevokeKey = useCallback(async (row: AgentWalletDashboardRow, keyId: string) => {
    if (!confirm('Revoke this agent API key?')) return;
    await runAction(`key-${keyId}`, async () => {
      await adminApi.revokeAgentApiKey(row.agent.id, keyId);
      await loadData();
    });
  }, [loadData, runAction]);

  return {
    loading,
    loadError,
    actionError,
    busyAction,
    orderedRows,
    totals,
    loadData,
    onStatusChange: handleStatusChange,
    onRevokeKey: handleRevokeKey,
  };
}
