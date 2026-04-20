import { Bot, Loader2, RotateCcw } from 'lucide-react';
import type { AgentWalletDashboardRow } from '../../src/api/admin';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorAlert } from '../ui/ErrorAlert';
import { AgentWalletRow } from './AgentWalletRow';
import { StatTile } from './DashboardPrimitives';
import { formatSats } from './agentWalletDashboardModel';
import type { AgentWalletDashboardTotals } from './agentWalletDashboardModel';

export interface AgentWalletDashboardViewProps {
  loading: boolean;
  loadError: string | null;
  actionError: string | null;
  busyAction: string | null;
  orderedRows: AgentWalletDashboardRow[];
  totals: AgentWalletDashboardTotals;
  loadData: () => Promise<void>;
  onStatusChange: (row: AgentWalletDashboardRow, status: 'active' | 'paused') => Promise<void>;
  onRevokeKey: (row: AgentWalletDashboardRow, keyId: string) => Promise<void>;
}

export function AgentWalletDashboardView(props: AgentWalletDashboardViewProps) {
  if (props.loading) {
    return <AgentWalletLoadingState />;
  }

  if (props.loadError) {
    return <AgentWalletLoadErrorState loadError={props.loadError} loadData={props.loadData} />;
  }

  return <AgentWalletDashboardContent {...props} />;
}

function AgentWalletLoadingState() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
    </div>
  );
}

function AgentWalletLoadErrorState({
  loadError,
  loadData,
}: {
  loadError: string;
  loadData: () => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <ErrorAlert message={loadError} />
      <Button onClick={loadData} variant="secondary">
        <RotateCcw className="mr-2 h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

function AgentWalletDashboardContent({
  actionError,
  busyAction,
  loadData,
  orderedRows,
  totals,
  onStatusChange,
  onRevokeKey,
}: AgentWalletDashboardViewProps) {
  return (
    <div className="animate-fade-in space-y-6 pb-12">
      <AgentWalletDashboardHeader loadData={loadData} />
      <ErrorAlert message={actionError} />
      <AgentWalletDashboardStats totals={totals} />
      <AgentWalletDashboardRows
        rows={orderedRows}
        busyAction={busyAction}
        onStatusChange={onStatusChange}
        onRevokeKey={onRevokeKey}
      />
    </div>
  );
}

function AgentWalletDashboardHeader({ loadData }: { loadData: () => Promise<void> }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Agent Wallets</h2>
        <p className="text-sanctuary-500 dark:text-sanctuary-400">Operational funds, pending funding, and safety alerts.</p>
      </div>
      <Button onClick={loadData} variant="secondary">
        <RotateCcw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </div>
  );
}

function AgentWalletDashboardStats({ totals }: { totals: AgentWalletDashboardTotals }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <StatTile label="Spend-ready agents" value={totals.spendReady.toString()} />
      <StatTile label="Operational balance" value={formatSats(totals.operationalBalance.toString())} />
      <StatTile label="Pending drafts" value={totals.pendingDrafts.toString()} />
      <StatTile label="Open alerts" value={totals.openAlerts.toString()} />
    </div>
  );
}

function AgentWalletDashboardRows({
  rows,
  busyAction,
  onStatusChange,
  onRevokeKey,
}: {
  rows: AgentWalletDashboardRow[];
  busyAction: string | null;
  onStatusChange: (row: AgentWalletDashboardRow, status: 'active' | 'paused') => Promise<void>;
  onRevokeKey: (row: AgentWalletDashboardRow, keyId: string) => Promise<void>;
}) {
  if (rows.length === 0) {
    return <AgentWalletEmptyState />;
  }

  return (
    <div className="space-y-4">
      {rows.map(row => (
        <AgentWalletRow
          key={row.agent.id}
          row={row}
          busyAction={busyAction}
          onStatusChange={onStatusChange}
          onRevokeKey={onRevokeKey}
        />
      ))}
    </div>
  );
}

function AgentWalletEmptyState() {
  return (
    <div className="rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <EmptyState
        icon={<Bot className="h-8 w-8" />}
        title="No agent wallets registered."
        description="Register a wallet agent before operational funds appear here."
      />
    </div>
  );
}
