import { KeyRound } from 'lucide-react';
import type { AgentApiKeyMetadata, WalletAgentMetadata } from '../../../src/api/admin';

export function ActiveKeyList({
  activeKeys,
  agent,
  onRevokeKey,
}: {
  activeKeys: AgentApiKeyMetadata[];
  agent: WalletAgentMetadata;
  onRevokeKey: (agent: WalletAgentMetadata, keyId: string) => void;
}) {
  if (activeKeys.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {activeKeys.map(key => (
        <AgentKeyChip key={key.id} agent={agent} apiKey={key} onRevokeKey={onRevokeKey} />
      ))}
    </div>
  );
}

function AgentKeyChip({
  agent,
  apiKey,
  onRevokeKey,
}: {
  agent: WalletAgentMetadata;
  apiKey: AgentApiKeyMetadata;
  onRevokeKey: (agent: WalletAgentMetadata, keyId: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 px-2 py-1 text-xs text-sanctuary-600 dark:text-sanctuary-300">
      <KeyRound className="w-3 h-3" />
      {apiKey.name} · {apiKey.keyPrefix}
      <button
        type="button"
        className="text-rose-500 hover:text-rose-600 dark:text-rose-300 dark:hover:text-rose-200"
        onClick={() => onRevokeKey(agent, apiKey.id)}
      >
        Revoke
      </button>
    </span>
  );
}
