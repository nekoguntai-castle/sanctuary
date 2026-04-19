import type { WalletAgentMetadata } from '../../../src/api/admin';
import { Button } from '../../ui/Button';

type AgentActionButtonsProps = {
  agent: WalletAgentMetadata;
  busyAction: string | null;
  disabled: boolean;
  onEdit: (agent: WalletAgentMetadata) => void;
  onRevoke: (agent: WalletAgentMetadata) => void;
  onOpenKeys: (agent: WalletAgentMetadata) => void;
  onOpenOverrides: (agent: WalletAgentMetadata) => void;
};

type AgentActionButtonProps = {
  agent: WalletAgentMetadata;
  disabled: boolean;
};

type IssueKeyButtonProps = AgentActionButtonProps & {
  onOpenKeys: (agent: WalletAgentMetadata) => void;
};

type OverridesButtonProps = AgentActionButtonProps & {
  onOpenOverrides: (agent: WalletAgentMetadata) => void;
};

type RevokeAgentButtonProps = AgentActionButtonProps & {
  busyAction: string | null;
  onRevoke: (agent: WalletAgentMetadata) => void;
};

export function AgentActionButtons({
  agent,
  busyAction,
  disabled,
  onEdit,
  onRevoke,
  onOpenKeys,
  onOpenOverrides,
}: AgentActionButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2 lg:justify-end">
      <EditAgentButton agent={agent} onEdit={onEdit} />
      <IssueKeyButton agent={agent} disabled={disabled} onOpenKeys={onOpenKeys} />
      <OverridesButton agent={agent} disabled={disabled} onOpenOverrides={onOpenOverrides} />
      <RevokeAgentButton agent={agent} busyAction={busyAction} disabled={disabled} onRevoke={onRevoke} />
    </div>
  );
}

function EditAgentButton({
  agent,
  onEdit,
}: {
  agent: WalletAgentMetadata;
  onEdit: (agent: WalletAgentMetadata) => void;
}) {
  return (
    <Button variant="secondary" size="sm" onClick={() => onEdit(agent)}>
      Edit
    </Button>
  );
}

function IssueKeyButton({
  agent,
  disabled,
  onOpenKeys,
}: IssueKeyButtonProps) {
  return (
    <Button variant="secondary" size="sm" onClick={() => onOpenKeys(agent)} disabled={disabled}>
      Issue Key
    </Button>
  );
}

function OverridesButton({
  agent,
  disabled,
  onOpenOverrides,
}: OverridesButtonProps) {
  return (
    <Button variant="secondary" size="sm" onClick={() => onOpenOverrides(agent)} disabled={disabled}>
      Overrides
    </Button>
  );
}

function RevokeAgentButton({
  agent,
  busyAction,
  disabled,
  onRevoke,
}: RevokeAgentButtonProps) {
  return (
    <Button
      variant="danger"
      size="sm"
      onClick={() => onRevoke(agent)}
      isLoading={busyAction === `revoke-${agent.id}`}
      disabled={disabled}
    >
      Revoke
    </Button>
  );
}
