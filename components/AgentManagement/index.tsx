import { useEffect, useState } from 'react';
import {
  Copy,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type {
  AgentManagementOptions,
  CreatedAgentApiKey,
  UpdateWalletAgentRequest,
  WalletAgentMetadata,
} from '../../src/api/admin';
import { extractErrorMessage } from '../../utils/errorHandler';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { ModalWrapper } from '../ui/ModalWrapper';
import { AgentFormModal } from './AgentManagement/AgentFormModal';
import { AgentRow } from './AgentManagement/AgentRow';
import type { AgentFormState } from './AgentManagement/formState';
import { AgentOverridesModal } from './AgentOverridesModal';

const EMPTY_OPTIONS: AgentManagementOptions = {
  users: [],
  wallets: [],
  devices: [],
};

function normalizeOptionalSats(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeNullableSats(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

function normalizeNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed);
}

function buildCreatePayload(form: AgentFormState): adminApi.CreateWalletAgentRequest {
  // Create omits blank policy fields so server defaults apply; update sends null to clear them.
  const maxFundingAmountSats = normalizeOptionalSats(form.maxFundingAmountSats);
  const maxOperationalBalanceSats = normalizeOptionalSats(form.maxOperationalBalanceSats);
  const dailyFundingLimitSats = normalizeOptionalSats(form.dailyFundingLimitSats);
  const weeklyFundingLimitSats = normalizeOptionalSats(form.weeklyFundingLimitSats);
  const cooldownMinutes = normalizeOptionalNumber(form.cooldownMinutes);
  const minOperationalBalanceSats = normalizeOptionalSats(form.minOperationalBalanceSats);
  const largeOperationalSpendSats = normalizeOptionalSats(form.largeOperationalSpendSats);
  const largeOperationalFeeSats = normalizeOptionalSats(form.largeOperationalFeeSats);
  const repeatedFailureThreshold = normalizeOptionalNumber(form.repeatedFailureThreshold);
  const repeatedFailureLookbackMinutes = normalizeOptionalNumber(form.repeatedFailureLookbackMinutes);
  const alertDedupeMinutes = normalizeOptionalNumber(form.alertDedupeMinutes);

  return {
    userId: form.userId,
    name: form.name.trim(),
    fundingWalletId: form.fundingWalletId,
    operationalWalletId: form.operationalWalletId,
    signerDeviceId: form.signerDeviceId,
    status: form.status,
    ...(maxFundingAmountSats && { maxFundingAmountSats }),
    ...(maxOperationalBalanceSats && { maxOperationalBalanceSats }),
    ...(dailyFundingLimitSats && { dailyFundingLimitSats }),
    ...(weeklyFundingLimitSats && { weeklyFundingLimitSats }),
    ...(cooldownMinutes !== undefined && { cooldownMinutes }),
    ...(minOperationalBalanceSats && { minOperationalBalanceSats }),
    ...(largeOperationalSpendSats && { largeOperationalSpendSats }),
    ...(largeOperationalFeeSats && { largeOperationalFeeSats }),
    ...(repeatedFailureThreshold !== undefined && { repeatedFailureThreshold }),
    ...(repeatedFailureLookbackMinutes !== undefined && { repeatedFailureLookbackMinutes }),
    ...(alertDedupeMinutes !== undefined && { alertDedupeMinutes }),
    requireHumanApproval: form.requireHumanApproval,
    notifyOnOperationalSpend: form.notifyOnOperationalSpend,
    pauseOnUnexpectedSpend: form.pauseOnUnexpectedSpend,
  };
}

function buildUpdatePayload(form: AgentFormState): UpdateWalletAgentRequest {
  return {
    name: form.name.trim(),
    status: form.status,
    maxFundingAmountSats: normalizeNullableSats(form.maxFundingAmountSats),
    maxOperationalBalanceSats: normalizeNullableSats(form.maxOperationalBalanceSats),
    dailyFundingLimitSats: normalizeNullableSats(form.dailyFundingLimitSats),
    weeklyFundingLimitSats: normalizeNullableSats(form.weeklyFundingLimitSats),
    cooldownMinutes: normalizeNullableNumber(form.cooldownMinutes),
    minOperationalBalanceSats: normalizeNullableSats(form.minOperationalBalanceSats),
    largeOperationalSpendSats: normalizeNullableSats(form.largeOperationalSpendSats),
    largeOperationalFeeSats: normalizeNullableSats(form.largeOperationalFeeSats),
    repeatedFailureThreshold: normalizeNullableNumber(form.repeatedFailureThreshold),
    repeatedFailureLookbackMinutes: normalizeNullableNumber(form.repeatedFailureLookbackMinutes),
    alertDedupeMinutes: normalizeNullableNumber(form.alertDedupeMinutes),
    requireHumanApproval: form.requireHumanApproval,
    notifyOnOperationalSpend: form.notifyOnOperationalSpend,
    pauseOnUnexpectedSpend: form.pauseOnUnexpectedSpend,
  };
}

export function AgentManagement() {
  const [agents, setAgents] = useState<WalletAgentMetadata[]>([]);
  const [options, setOptions] = useState<AgentManagementOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState<WalletAgentMetadata | null>(null);
  const [keyAgent, setKeyAgent] = useState<WalletAgentMetadata | null>(null);
  const [overrideAgent, setOverrideAgent] = useState<WalletAgentMetadata | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedAgentApiKey | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [agentList, optionList] = await Promise.all([
        adminApi.getWalletAgents(),
        adminApi.getWalletAgentOptions(),
      ]);
      setAgents(agentList);
      setOptions(optionList);
    } catch (error) {
      setLoadError(extractErrorMessage(error, 'Failed to load wallet agents'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const activeAgents = agents.filter(agent => agent.status === 'active' && !agent.revokedAt).length;
  const pausedAgents = agents.filter(agent => agent.status === 'paused').length;
  const activeKeys = agents.reduce((sum, agent) => sum + (agent.apiKeys ?? []).filter(key => !key.revokedAt).length, 0);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusyAction(key);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(extractErrorMessage(error, 'Agent action failed'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateAgent = async (form: AgentFormState) => {
    await runAction('create-agent', async () => {
      await adminApi.createWalletAgent(buildCreatePayload(form));
      setShowCreate(false);
      await loadData();
    });
  };

  const handleUpdateAgent = async (form: AgentFormState) => {
    if (!editingAgent) return;
    await runAction(`update-${editingAgent.id}`, async () => {
      await adminApi.updateWalletAgent(editingAgent.id, buildUpdatePayload(form));
      setEditingAgent(null);
      await loadData();
    });
  };

  const handleRevokeAgent = async (agent: WalletAgentMetadata) => {
    if (!confirm(`Revoke agent "${agent.name}"? Existing wallet descriptors will not change.`)) return;
    await runAction(`revoke-${agent.id}`, async () => {
      await adminApi.revokeWalletAgent(agent.id);
      await loadData();
    });
  };

  const handleCreateKey = async (name: string, expiresAt: string) => {
    if (!keyAgent) return;
    await runAction(`key-${keyAgent.id}`, async () => {
      const trimmedExpiresAt = expiresAt.trim();
      const payload: adminApi.CreateAgentApiKeyRequest = {
        name: name.trim(),
        allowedActions: ['create_funding_draft'],
      };

      if (trimmedExpiresAt) {
        const parsedExpiresAt = new Date(trimmedExpiresAt);
        if (Number.isNaN(parsedExpiresAt.getTime())) {
          throw new Error('Enter a valid expiration date');
        }
        payload.expiresAt = parsedExpiresAt.toISOString();
      }

      const key = await adminApi.createAgentApiKey(keyAgent.id, payload);
      setCreatedKey(key);
      setCopiedKey(false);
      await loadData();
    });
  };

  const handleRevokeKey = async (agent: WalletAgentMetadata, keyId: string) => {
    if (!confirm('Revoke this agent API key?')) return;
    await runAction(`revoke-key-${keyId}`, async () => {
      await adminApi.revokeAgentApiKey(agent.id, keyId);
      await loadData();
    });
  };

  const handleCopyCreatedKey = async () => {
    if (!createdKey?.apiKey) return;
    if (!navigator.clipboard?.writeText) {
      setActionError('Clipboard is not available in this browser');
      return;
    }

    try {
      await navigator.clipboard.writeText(createdKey.apiKey);
      setCopiedKey(true);
    } catch (error) {
      setActionError(extractErrorMessage(error, 'Failed to copy agent API key'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <ErrorAlert message={loadError} />
        <Button onClick={loadData} variant="secondary">
          <RotateCcw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Wallet Agents</h2>
          <p className="text-sanctuary-500">Register funding agents, issue scoped keys, and manage policy caps.</p>
        </div>
        <Button onClick={() => { setActionError(null); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Create Agent
        </Button>
      </div>

      <ErrorAlert message={actionError} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatTile label="Active agents" value={activeAgents.toString()} />
        <StatTile label="Paused agents" value={pausedAgents.toString()} />
        <StatTile label="Active keys" value={activeKeys.toString()} />
      </div>

      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        {agents.length === 0 ? (
          <div className="p-8 text-center text-sanctuary-500">
            No wallet agents registered.
          </div>
        ) : (
          <div className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
            {agents.map(agent => (
              <AgentRow
                key={agent.id}
                agent={agent}
                busyAction={busyAction}
                onEdit={setEditingAgent}
                onRevoke={handleRevokeAgent}
                onOpenKeys={(selected) => {
                  setKeyAgent(selected);
                  setCreatedKey(null);
                  setCopiedKey(false);
                  setActionError(null);
                }}
                onOpenOverrides={(selected) => {
                  setOverrideAgent(selected);
                  setActionError(null);
                }}
                onRevokeKey={handleRevokeKey}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <AgentFormModal
          title="Create Wallet Agent"
          options={options}
          isSaving={busyAction === 'create-agent'}
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreateAgent}
        />
      )}

      {editingAgent && (
        <AgentFormModal
          title="Edit Wallet Agent"
          agent={editingAgent}
          options={options}
          isSaving={busyAction === `update-${editingAgent.id}`}
          onClose={() => setEditingAgent(null)}
          onSubmit={handleUpdateAgent}
        />
      )}

      {keyAgent && (
        <AgentKeyModal
          agent={keyAgent}
          createdKey={createdKey}
          copiedKey={copiedKey}
          isSaving={busyAction === `key-${keyAgent.id}`}
          onClose={() => {
            setKeyAgent(null);
            setCreatedKey(null);
            setCopiedKey(false);
          }}
          onCreate={handleCreateKey}
          onCopy={handleCopyCreatedKey}
        />
      )}

      {overrideAgent && (
        <AgentOverridesModal
          agent={overrideAgent}
          onClose={() => setOverrideAgent(null)}
        />
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
      <div className="text-sm text-sanctuary-500 dark:text-sanctuary-400">{label}</div>
      <div className="mt-1 text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-100">{value}</div>
    </div>
  );
}

function AgentKeyModal({
  agent,
  createdKey,
  copiedKey,
  isSaving,
  onClose,
  onCreate,
  onCopy,
}: {
  agent: WalletAgentMetadata;
  createdKey: CreatedAgentApiKey | null;
  copiedKey: boolean;
  isSaving: boolean;
  onClose: () => void;
  onCreate: (name: string, expiresAt: string) => Promise<void>;
  onCopy: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  return (
    <ModalWrapper title={`Issue key for ${agent.name}`} onClose={onClose} maxWidth="lg" headerBorder>
      {createdKey ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-900/20 p-3 text-sm text-success-700 dark:text-success-300">
            This token is shown once. Store it in the agent runtime before closing.
          </div>
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Agent API key</label>
            <div className="flex gap-2">
              <Input readOnly value={createdKey.apiKey} className="font-mono text-sm" />
              <Button variant="secondary" onClick={onCopy}>
                <Copy className="w-4 h-4 mr-2" />
                {copiedKey ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Key name *</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Agent runtime key" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Expires at</label>
            <Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </div>
          <div className="rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 p-3 text-sm text-sanctuary-600 dark:text-sanctuary-300 flex gap-2">
            <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-shared-600 dark:text-shared-300" />
            <span>The key can submit funding drafts only for this agent. It cannot broadcast, approve policies, or manage wallets.</span>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onCreate(name, expiresAt)} isLoading={isSaving} disabled={!name.trim()}>
              Create Key
            </Button>
          </div>
        </div>
      )}
    </ModalWrapper>
  );
}
