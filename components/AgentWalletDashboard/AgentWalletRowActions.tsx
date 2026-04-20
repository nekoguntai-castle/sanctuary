import type { AgentWalletDashboardRow } from '../../src/api/admin';
import { Button } from '../ui/Button';
import { LinkButton } from '../ui/LinkButton';

export function AgentWalletRowActions({
  row,
  busyAction,
  revoked,
  onStatusChange,
}: {
  row: AgentWalletDashboardRow;
  busyAction: string | null;
  revoked: boolean;
  onStatusChange: (row: AgentWalletDashboardRow, status: 'active' | 'paused') => Promise<void>;
}) {
  const { agent } = row;

  return (
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
      <AgentStatusActionButton
        row={row}
        busyAction={busyAction}
        revoked={revoked}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}

function AgentStatusActionButton({
  row,
  busyAction,
  revoked,
  onStatusChange,
}: {
  row: AgentWalletDashboardRow;
  busyAction: string | null;
  revoked: boolean;
  onStatusChange: (row: AgentWalletDashboardRow, status: 'active' | 'paused') => Promise<void>;
}) {
  const { agent } = row;

  if (agent.status === 'paused' && !revoked) {
    return (
      <Button
        size="sm"
        onClick={() => onStatusChange(row, 'active')}
        isLoading={busyAction === `status-${agent.id}`}
      >
        Unpause
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => onStatusChange(row, 'paused')}
      isLoading={busyAction === `status-${agent.id}`}
      disabled={revoked}
    >
      Pause
    </Button>
  );
}
