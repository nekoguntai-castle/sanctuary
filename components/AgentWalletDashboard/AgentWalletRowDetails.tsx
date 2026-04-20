import type {
  AgentApiKeyMetadata,
  AgentWalletDashboardRow,
} from '../../src/api/admin';
import {
  AlertAndKeyPanel,
  DraftPanel,
  PolicyPanel,
  SpendPanel,
} from './AgentWalletDetailPanels';

export function AgentWalletRowDetails({
  row,
  activeKeys,
  busyAction,
  onRevokeKey,
}: {
  row: AgentWalletDashboardRow;
  activeKeys: AgentApiKeyMetadata[];
  busyAction: string | null;
  onRevokeKey: (row: AgentWalletDashboardRow, keyId: string) => Promise<void>;
}) {
  return (
    <details className="mt-4 rounded-lg border border-sanctuary-100 bg-sanctuary-50/50 p-3 dark:border-sanctuary-800 dark:bg-sanctuary-950/40">
      <summary className="cursor-pointer text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        Review details
      </summary>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-4">
        <PolicyPanel agent={row.agent} />
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
  );
}
