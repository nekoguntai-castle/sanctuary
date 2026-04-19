import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  Check,
  KeyRound,
  Loader2,
  PauseCircle,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type {
  AgentApiKeyMetadata,
  AgentWalletDashboardDraft,
  AgentWalletDashboardRow,
  AgentWalletDashboardTransaction,
  WalletAgentMetadata,
} from '../../src/api/admin';
import { extractErrorMessage } from '../../utils/errorHandler';
import { createLogger } from '../../utils/logger';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorAlert } from '../ui/ErrorAlert';
import { LinkButton } from '../ui/LinkButton';

const log = createLogger('AgentWalletDashboard');
const DESTINATION_CLASSIFICATION_LABELS: Record<string, string> = {
  external_spend: 'External spend',
  known_self_transfer: 'Known self-transfer',
  change_like_movement: 'Change-like movement',
  unknown_destination: 'Unknown destination',
};

const UNKNOWN_DESTINATION_HANDLING_LABELS: Record<string, string> = {
  notify_only: 'Notify only',
  pause_agent: 'Pause agent',
  notify_and_pause: 'Notify and pause',
  record_only: 'Record only',
};

function formatSats(value: string | null | undefined): string {
  if (!value) return '0 sats';
  try {
    return `${BigInt(value).toLocaleString()} sats`;
  } catch {
    return `${value} sats`;
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function formatWalletType(type: string | undefined): string {
  if (type === 'multi_sig') return 'Multisig';
  if (type === 'single_sig') return 'Single sig';
  return type ?? 'Wallet';
}

function formatTxid(txid: string): string {
  return txid.length > 16 ? `${txid.slice(0, 8)}...${txid.slice(-8)}` : txid;
}

function metadataString(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function formatDestinationClassification(metadata: Record<string, unknown> | null): string | null {
  const classification = metadataString(metadata, 'destinationClassification');
  if (!classification) return null;
  return DESTINATION_CLASSIFICATION_LABELS[classification] ?? classification.replace(/_/g, ' ');
}

function formatUnknownDestinationHandling(metadata: Record<string, unknown> | null): string | null {
  const mode = metadataString(metadata, 'unknownDestinationHandlingMode');
  if (!mode) return null;
  return UNKNOWN_DESTINATION_HANDLING_LABELS[mode] ?? mode.replace(/_/g, ' ');
}

function findSpendDestinationClassification(
  spend: AgentWalletDashboardTransaction,
  alerts: AgentWalletDashboardRow['recentAlerts']
): string | null {
  const matchingAlert = alerts.find(alert => alert.txid === spend.txid && formatDestinationClassification(alert.metadata));
  return matchingAlert ? formatDestinationClassification(matchingAlert.metadata) : null;
}

function isKeyActive(key: AgentApiKeyMetadata, now = Date.now()): boolean {
  if (key.revokedAt) return false;
  if (!key.expiresAt) return true;
  return new Date(key.expiresAt).getTime() > now;
}

function isAgentRevoked(agent: WalletAgentMetadata): boolean {
  return agent.status === 'revoked' || Boolean(agent.revokedAt);
}

function canSpendNow(row: AgentWalletDashboardRow): boolean {
  if (row.agent.status !== 'active' || isAgentRevoked(row.agent)) return false;
  try {
    return BigInt(row.operationalBalanceSats) > 0n;
  } catch {
    return false;
  }
}

function statusBadge(agent: WalletAgentMetadata) {
  if (agent.status === 'active' && !agent.revokedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
        <Check className="h-3 w-3" />
        Active
      </span>
    );
  }

  if (agent.status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
        <PauseCircle className="h-3 w-3" />
        Paused
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
      <AlertTriangle className="h-3 w-3" />
      Revoked
    </span>
  );
}

export function AgentWalletDashboard() {
  const [rows, setRows] = useState<AgentWalletDashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadData = async () => {
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
  };

  useEffect(() => {
    void loadData();
  }, []);

  const orderedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aAttention = a.openAlertCount + a.pendingFundingDraftCount;
      const bAttention = b.openAlertCount + b.pendingFundingDraftCount;
      if (aAttention !== bAttention) return bAttention - aAttention;
      return a.agent.name.localeCompare(b.agent.name);
    });
  }, [rows]);

  const totals = useMemo(() => {
    return rows.reduce((acc, row) => {
      acc.spendReady += canSpendNow(row) ? 1 : 0;
      acc.pendingDrafts += row.pendingFundingDraftCount;
      acc.openAlerts += row.openAlertCount;
      try {
        acc.operationalBalance += BigInt(row.operationalBalanceSats);
      } catch (error) {
        log.debug('Ignoring malformed operational balance in agent dashboard totals', {
          agentId: row.agent.id,
          operationalBalanceSats: row.operationalBalanceSats,
          error: extractErrorMessage(error, 'Invalid operational balance'),
        });
      }
      return acc;
    }, {
      spendReady: 0,
      pendingDrafts: 0,
      openAlerts: 0,
      operationalBalance: 0n,
    });
  }, [rows]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyAction(key);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(extractErrorMessage(error, 'Agent wallet action failed'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleStatusChange = async (row: AgentWalletDashboardRow, status: 'active' | 'paused') => {
    await runAction(`status-${row.agent.id}`, async () => {
      await adminApi.updateWalletAgent(row.agent.id, { status });
      await loadData();
    });
  };

  const handleRevokeKey = async (row: AgentWalletDashboardRow, keyId: string) => {
    if (!confirm('Revoke this agent API key?')) return;
    await runAction(`key-${keyId}`, async () => {
      await adminApi.revokeAgentApiKey(row.agent.id, keyId);
      await loadData();
    });
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (loadError) {
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

  return (
    <div className="animate-fade-in space-y-6 pb-12">
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

      <ErrorAlert message={actionError} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatTile label="Spend-ready agents" value={totals.spendReady.toString()} />
        <StatTile label="Operational balance" value={formatSats(totals.operationalBalance.toString())} />
        <StatTile label="Pending drafts" value={totals.pendingDrafts.toString()} />
        <StatTile label="Open alerts" value={totals.openAlerts.toString()} />
      </div>

      {orderedRows.length === 0 ? (
        <div className="rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <EmptyState
            icon={<Bot className="h-8 w-8" />}
            title="No agent wallets registered."
            description="Register a wallet agent before operational funds appear here."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {orderedRows.map(row => (
            <AgentWalletRow
              key={row.agent.id}
              row={row}
              busyAction={busyAction}
              onStatusChange={handleStatusChange}
              onRevokeKey={handleRevokeKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-sanctuary-200 bg-white p-4 dark:border-sanctuary-800 dark:bg-sanctuary-900">
      <div className="text-sm text-sanctuary-500 dark:text-sanctuary-400">{label}</div>
      <div className="mt-1 text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-100">{value}</div>
    </div>
  );
}

function AgentWalletRow({
  row,
  busyAction,
  onStatusChange,
  onRevokeKey,
}: {
  row: AgentWalletDashboardRow;
  busyAction: string | null;
  onStatusChange: (row: AgentWalletDashboardRow, status: 'active' | 'paused') => Promise<void>;
  onRevokeKey: (row: AgentWalletDashboardRow, keyId: string) => Promise<void>;
}) {
  const { agent } = row;
  const activeKeys = (agent.apiKeys ?? []).filter(key => isKeyActive(key));
  const revoked = isAgentRevoked(agent);

  return (
    <div className="rounded-lg border border-sanctuary-200 bg-white p-4 dark:border-sanctuary-800 dark:bg-sanctuary-900">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="h-4 w-4 text-shared-600 dark:text-shared-300" />
            <h3 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{agent.name}</h3>
            {statusBadge(agent)}
            {canSpendNow(row) && (
              <span className="inline-flex items-center gap-1 rounded-full border border-success-200 bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700 dark:border-success-800 dark:bg-success-900/20 dark:text-success-300">
                <ShieldCheck className="h-3 w-3" />
                Operational funds available
              </span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Metric label="Operational balance" value={formatSats(row.operationalBalanceSats)} />
            <Metric label="Pending drafts" value={row.pendingFundingDraftCount.toString()} />
            <Metric label="Last request" value={formatDateTime(row.lastFundingDraft?.createdAt)} />
            <Metric label="Open alerts" value={row.openAlertCount.toString()} />
            <Metric label="Active keys" value={row.activeKeyCount.toString()} />
            <Metric label="Last spend" value={formatDateTime(row.lastOperationalSpend?.blockTime ?? row.lastOperationalSpend?.createdAt)} />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <WalletLinkBlock
              label="Funding wallet"
              walletId={agent.fundingWalletId}
              name={agent.fundingWallet?.name ?? agent.fundingWalletId}
              helper={formatWalletType(agent.fundingWallet?.type)}
            />
            <WalletLinkBlock
              label="Operational wallet"
              walletId={agent.operationalWalletId}
              name={agent.operationalWallet?.name ?? agent.operationalWalletId}
              helper={formatWalletType(agent.operationalWallet?.type)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          {row.pendingFundingDraftCount > 0 && (
            <LinkButton
              to={`/wallets/${agent.fundingWalletId}`}
              state={{ activeTab: 'drafts' }}
            >
              Review Drafts
            </LinkButton>
          )}
          <LinkButton to={`/wallets/${agent.fundingWalletId}`}>
            Funding Wallet
          </LinkButton>
          <LinkButton to={`/wallets/${agent.operationalWalletId}`}>
            Operational Wallet
          </LinkButton>
          {agent.status === 'paused' && !revoked ? (
            <Button
              size="sm"
              onClick={() => onStatusChange(row, 'active')}
              isLoading={busyAction === `status-${agent.id}`}
            >
              Unpause
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onStatusChange(row, 'paused')}
              isLoading={busyAction === `status-${agent.id}`}
              disabled={revoked}
            >
              Pause
            </Button>
          )}
        </div>
      </div>

      <details className="mt-4 rounded-lg border border-sanctuary-100 bg-sanctuary-50/50 p-3 dark:border-sanctuary-800 dark:bg-sanctuary-950/40">
        <summary className="cursor-pointer text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
          Review details
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-4">
          <PolicyPanel agent={agent} />
          <DraftPanel drafts={row.recentFundingDrafts} />
          <SpendPanel spends={row.recentOperationalSpends} alerts={row.recentAlerts} />
          <AlertAndKeyPanel
            alerts={row.recentAlerts}
            activeKeys={activeKeys}
            busyAction={busyAction}
            row={row}
            onRevokeKey={onRevokeKey}
          />
        </div>
      </details>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-sanctuary-500 dark:text-sanctuary-400">{label}</div>
      <div className="truncate text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{value}</div>
    </div>
  );
}

function WalletLinkBlock({
  label,
  walletId,
  name,
  helper,
}: {
  label: string;
  walletId: string;
  name: string;
  helper: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-sanctuary-100 p-3 dark:border-sanctuary-800">
      <div className="flex items-center gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
        <Wallet className="h-3 w-3" />
        {label}
      </div>
      <Link to={`/wallets/${walletId}`} className="mt-1 block truncate font-medium text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200">
        {name}
      </Link>
      <div className="truncate text-xs text-sanctuary-500 dark:text-sanctuary-400">{helper}</div>
    </div>
  );
}

function PolicyPanel({ agent }: { agent: WalletAgentMetadata }) {
  return (
    <DetailPanel title="Policy">
      <DetailLine label="Request cap" value={agent.maxFundingAmountSats ? formatSats(agent.maxFundingAmountSats) : 'No cap'} />
      <DetailLine label="Balance cap" value={agent.maxOperationalBalanceSats ? formatSats(agent.maxOperationalBalanceSats) : 'No cap'} />
      <DetailLine label="Daily cap" value={agent.dailyFundingLimitSats ? formatSats(agent.dailyFundingLimitSats) : 'No cap'} />
      <DetailLine label="Weekly cap" value={agent.weeklyFundingLimitSats ? formatSats(agent.weeklyFundingLimitSats) : 'No cap'} />
      <DetailLine label="Refill alert" value={agent.minOperationalBalanceSats ? formatSats(agent.minOperationalBalanceSats) : 'Off'} />
      <DetailLine label="Cooldown" value={`${agent.cooldownMinutes ?? 0} min`} />
    </DetailPanel>
  );
}

function DraftPanel({ drafts }: { drafts: AgentWalletDashboardDraft[] }) {
  return (
    <DetailPanel title="Funding Requests">
      {drafts.length === 0 ? (
        <EmptyDetail text="No recent funding requests." />
      ) : (
        drafts.map(draft => (
          <div key={draft.id} className="rounded-md border border-sanctuary-100 p-2 text-xs dark:border-sanctuary-800">
            <div className="font-medium text-sanctuary-800 dark:text-sanctuary-200">{formatSats(draft.amountSats)}</div>
            <div className="text-sanctuary-500 dark:text-sanctuary-400">{draft.status} · {draft.approvalStatus}</div>
            <div className="text-sanctuary-500 dark:text-sanctuary-400">{formatDateTime(draft.createdAt)}</div>
          </div>
        ))
      )}
    </DetailPanel>
  );
}

function SpendPanel({
  spends,
  alerts,
}: {
  spends: AgentWalletDashboardTransaction[];
  alerts: AgentWalletDashboardRow['recentAlerts'];
}) {
  return (
    <DetailPanel title="Operational Spends">
      {spends.length === 0 ? (
        <EmptyDetail text="No operational spends recorded." />
      ) : (
        spends.map((spend) => {
          const destinationClassification = findSpendDestinationClassification(spend, alerts);
          return (
            <div key={spend.id} className="rounded-md border border-sanctuary-100 p-2 text-xs dark:border-sanctuary-800">
              <div className="font-medium text-sanctuary-800 dark:text-sanctuary-200">{formatSats(spend.amountSats)}</div>
              <div className="text-sanctuary-500 dark:text-sanctuary-400">
                {spend.feeSats ? `${formatSats(spend.feeSats)} fee · ` : ''}{spend.confirmations} conf
              </div>
              {destinationClassification && (
                <div className="text-warning-700 dark:text-warning-300">Destination: {destinationClassification}</div>
              )}
              {spend.counterpartyAddress && (
                <div className="truncate font-mono text-sanctuary-500 dark:text-sanctuary-400">{spend.counterpartyAddress}</div>
              )}
              <div className="font-mono text-sanctuary-500 dark:text-sanctuary-400">{formatTxid(spend.txid)}</div>
            </div>
          );
        })
      )}
    </DetailPanel>
  );
}

function AlertAndKeyPanel({
  alerts,
  activeKeys,
  busyAction,
  row,
  onRevokeKey,
}: {
  alerts: AgentWalletDashboardRow['recentAlerts'];
  activeKeys: AgentApiKeyMetadata[];
  busyAction: string | null;
  row: AgentWalletDashboardRow;
  onRevokeKey: (row: AgentWalletDashboardRow, keyId: string) => Promise<void>;
}) {
  return (
    <DetailPanel title="Alerts And Keys">
      {alerts.length === 0 ? (
        <EmptyDetail text="No open alerts." />
      ) : (
        alerts.map((alert) => {
          const destinationClassification = formatDestinationClassification(alert.metadata);
          const handlingMode = formatUnknownDestinationHandling(alert.metadata);
          return (
            <div key={alert.id} className="rounded-md border border-warning-200 bg-warning-50 p-2 text-xs text-warning-800 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
              <div className="font-medium">{alert.type}</div>
              <div>{alert.message}</div>
              {destinationClassification && <div>Destination: {destinationClassification}</div>}
              {handlingMode && <div>Handling: {handlingMode}</div>}
            </div>
          );
        })
      )}

      <div className="border-t border-sanctuary-100 pt-3 dark:border-sanctuary-800">
        {activeKeys.length === 0 ? (
          <EmptyDetail text="No active keys." />
        ) : (
          activeKeys.map(key => (
            <div key={key.id} className="mb-2 flex items-center justify-between gap-2 rounded-md border border-sanctuary-100 p-2 text-xs dark:border-sanctuary-800">
              <span className="min-w-0 truncate text-sanctuary-700 dark:text-sanctuary-300">
                <KeyRound className="mr-1 inline h-3 w-3" />
                {key.name} · {key.keyPrefix}
              </span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => onRevokeKey(row, key.id)}
                isLoading={busyAction === `key-${key.id}`}
              >
                Revoke
              </Button>
            </div>
          ))
        )}
      </div>
    </DetailPanel>
  );
}

function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-sanctuary-500 dark:text-sanctuary-400">{label}</span>
      <span className="text-right font-medium text-sanctuary-800 dark:text-sanctuary-200">{value}</span>
    </div>
  );
}

function EmptyDetail({ text }: { text: string }) {
  return <div className="text-xs text-sanctuary-500 dark:text-sanctuary-400">{text}</div>;
}
