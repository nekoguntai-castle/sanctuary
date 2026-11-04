import { useCallback, useEffect, useMemo, useState } from 'react';
import * as adminApi from '../../api/admin';
import { ApiError } from '../../api/client';
import type { AgentAlertTransition, AgentWalletDashboardRow } from '../../api/admin';
import type { WalletAgentToggleStatus } from '@sanctuary/shared/constants/adminAgents';
import { extractErrorMessage } from '../../utils/errorHandler';
import {
  agentAlertActionKey,
  applyAgentAlertUpdate,
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

  const handleStatusChange = useCallback(async (row: AgentWalletDashboardRow, status: WalletAgentToggleStatus) => {
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

  const handleAlertTransition = useCallback(async (
    row: AgentWalletDashboardRow,
    alertId: string,
    transition: AgentAlertTransition
  ) => {
    await runAction(agentAlertActionKey(alertId, transition), async () => {
      try {
        const updated = transition === 'acknowledge'
          ? await adminApi.acknowledgeAgentAlert(row.agent.id, alertId)
          : await adminApi.resolveAgentAlert(row.agent.id, alertId);
        setRows(current => applyAgentAlertUpdate(current, row.agent.id, updated));
      } catch (error) {
        // 409: another admin moved the alert first, so this row is stale; show the server's state.
        if (error instanceof ApiError && error.status === 409) await loadData();
        throw error;
      }
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
    onAlertTransition: handleAlertTransition,
  };
}
