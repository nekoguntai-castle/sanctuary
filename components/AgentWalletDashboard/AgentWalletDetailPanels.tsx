import { KeyRound } from 'lucide-react';
import type {
  AgentApiKeyMetadata,
  AgentWalletDashboardDraft,
  AgentWalletDashboardRow,
  AgentWalletDashboardTransaction,
  WalletAgentMetadata,
} from '../../src/api/admin';
import { Button } from '../ui/Button';
import {
  DetailLine,
  DetailPanel,
  EmptyDetail,
} from './DashboardPrimitives';
import {
  findSpendDestinationClassification,
  formatDateTime,
  formatDestinationClassification,
  formatSats,
  formatTxid,
  formatUnknownDestinationHandling,
} from './agentWalletDashboardModel';

export function PolicyPanel({ agent }: { agent: WalletAgentMetadata }) {
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

export function DraftPanel({ drafts }: { drafts: AgentWalletDashboardDraft[] }) {
  return (
    <DetailPanel title="Funding Requests">
      {drafts.length === 0 ? (
        <EmptyDetail text="No recent funding requests." />
      ) : (
        drafts.map(draft => <DraftDetail key={draft.id} draft={draft} />)
      )}
    </DetailPanel>
  );
}

function DraftDetail({ draft }: { draft: AgentWalletDashboardDraft }) {
  return (
    <div className="rounded-md border border-sanctuary-100 p-2 text-xs dark:border-sanctuary-800">
      <div className="font-medium text-sanctuary-800 dark:text-sanctuary-200">{formatSats(draft.amountSats)}</div>
      <div className="text-sanctuary-500 dark:text-sanctuary-400">{draft.status} · {draft.approvalStatus}</div>
      <div className="text-sanctuary-500 dark:text-sanctuary-400">{formatDateTime(draft.createdAt)}</div>
    </div>
  );
}

export function SpendPanel({
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
        spends.map(spend => <SpendDetail key={spend.id} spend={spend} alerts={alerts} />)
      )}
    </DetailPanel>
  );
}

function SpendDetail({
  spend,
  alerts,
}: {
  spend: AgentWalletDashboardTransaction;
  alerts: AgentWalletDashboardRow['recentAlerts'];
}) {
  const destinationClassification = findSpendDestinationClassification(spend, alerts);

  return (
    <div className="rounded-md border border-sanctuary-100 p-2 text-xs dark:border-sanctuary-800">
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
}

export function AlertAndKeyPanel({
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
      <AlertList alerts={alerts} />
      <ActiveKeyList
        activeKeys={activeKeys}
        busyAction={busyAction}
        row={row}
        onRevokeKey={onRevokeKey}
      />
    </DetailPanel>
  );
}

function AlertList({ alerts }: { alerts: AgentWalletDashboardRow['recentAlerts'] }) {
  if (alerts.length === 0) {
    return <EmptyDetail text="No open alerts." />;
  }

  return (
    <>
      {alerts.map(alert => <AlertDetail key={alert.id} alert={alert} />)}
    </>
  );
}

function AlertDetail({ alert }: { alert: AgentWalletDashboardRow['recentAlerts'][number] }) {
  const destinationClassification = formatDestinationClassification(alert.metadata);
  const handlingMode = formatUnknownDestinationHandling(alert.metadata);

  return (
    <div className="rounded-md border border-warning-200 bg-warning-50 p-2 text-xs text-warning-800 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
      <div className="font-medium">{alert.type}</div>
      <div>{alert.message}</div>
      {destinationClassification && <div>Destination: {destinationClassification}</div>}
      {handlingMode && <div>Handling: {handlingMode}</div>}
    </div>
  );
}

function ActiveKeyList({
  activeKeys,
  busyAction,
  row,
  onRevokeKey,
}: {
  activeKeys: AgentApiKeyMetadata[];
  busyAction: string | null;
  row: AgentWalletDashboardRow;
  onRevokeKey: (row: AgentWalletDashboardRow, keyId: string) => Promise<void>;
}) {
  return (
    <div className="border-t border-sanctuary-100 pt-3 dark:border-sanctuary-800">
      {activeKeys.length === 0 ? (
        <EmptyDetail text="No active keys." />
      ) : (
        activeKeys.map(key => (
          <ApiKeyDetail
            key={key.id}
            apiKey={key}
            busyAction={busyAction}
            row={row}
            onRevokeKey={onRevokeKey}
          />
        ))
      )}
    </div>
  );
}

function ApiKeyDetail({
  apiKey,
  busyAction,
  row,
  onRevokeKey,
}: {
  apiKey: AgentApiKeyMetadata;
  busyAction: string | null;
  row: AgentWalletDashboardRow;
  onRevokeKey: (row: AgentWalletDashboardRow, keyId: string) => Promise<void>;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-sanctuary-100 p-2 text-xs dark:border-sanctuary-800">
      <span className="min-w-0 truncate text-sanctuary-700 dark:text-sanctuary-300">
        <KeyRound className="mr-1 inline h-3 w-3" />
        {apiKey.name} · {apiKey.keyPrefix}
      </span>
      <Button
        size="sm"
        variant="danger"
        onClick={() => onRevokeKey(row, apiKey.id)}
        isLoading={busyAction === `key-${apiKey.id}`}
      >
        Revoke
      </Button>
    </div>
  );
}
