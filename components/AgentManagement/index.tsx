import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  KeyRound,
  Loader2,
  PauseCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type {
  AgentManagementOptions,
  AgentOptionWallet,
  CreatedAgentApiKey,
  UpdateWalletAgentRequest,
  WalletAgentMetadata,
  WalletAgentStatus,
} from '../../src/api/admin';
import { extractErrorMessage } from '../../utils/errorHandler';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { ModalWrapper } from '../ui/ModalWrapper';
import { Toggle } from '../ui/Toggle';

const EMPTY_OPTIONS: AgentManagementOptions = {
  users: [],
  wallets: [],
  devices: [],
};

const DEFAULT_AGENT_FORM = {
  name: '',
  userId: '',
  fundingWalletId: '',
  operationalWalletId: '',
  signerDeviceId: '',
  status: 'active' as WalletAgentStatus,
  maxFundingAmountSats: '',
  maxOperationalBalanceSats: '',
  dailyFundingLimitSats: '',
  weeklyFundingLimitSats: '',
  cooldownMinutes: '',
  minOperationalBalanceSats: '',
  largeOperationalSpendSats: '',
  largeOperationalFeeSats: '',
  repeatedFailureThreshold: '',
  repeatedFailureLookbackMinutes: '',
  alertDedupeMinutes: '',
  requireHumanApproval: true,
  notifyOnOperationalSpend: true,
  pauseOnUnexpectedSpend: false,
};

type AgentFormState = typeof DEFAULT_AGENT_FORM;

const POLICY_FIELDS: Array<{
  key: keyof Pick<
    AgentFormState,
    'maxFundingAmountSats' | 'maxOperationalBalanceSats' | 'dailyFundingLimitSats' | 'weeklyFundingLimitSats'
  >;
  label: string;
  helper: string;
}> = [
  { key: 'maxFundingAmountSats', label: 'Per-request cap', helper: 'Maximum sats in one funding draft.' },
  { key: 'maxOperationalBalanceSats', label: 'Operational balance cap', helper: 'Reject funding when the operational wallet is already above this balance.' },
  { key: 'dailyFundingLimitSats', label: 'Daily cap', helper: 'Maximum accepted funding amount per UTC day.' },
  { key: 'weeklyFundingLimitSats', label: 'Weekly cap', helper: 'Maximum accepted funding amount per UTC week.' },
];

const MONITORING_SATS_FIELDS: Array<{
  key: keyof Pick<
    AgentFormState,
    'minOperationalBalanceSats' | 'largeOperationalSpendSats' | 'largeOperationalFeeSats'
  >;
  label: string;
  helper: string;
}> = [
  { key: 'minOperationalBalanceSats', label: 'Refill threshold', helper: 'Alert when the operational wallet drops below this balance.' },
  { key: 'largeOperationalSpendSats', label: 'Large spend alert', helper: 'Alert when a single operational spend meets or exceeds this amount.' },
  { key: 'largeOperationalFeeSats', label: 'Large fee alert', helper: 'Alert when an operational transaction fee meets or exceeds this amount.' },
];

const MONITORING_NUMBER_FIELDS: Array<{
  key: keyof Pick<
    AgentFormState,
    'repeatedFailureThreshold' | 'repeatedFailureLookbackMinutes' | 'alertDedupeMinutes'
  >;
  label: string;
  helper: string;
  placeholder: string;
}> = [
  { key: 'repeatedFailureThreshold', label: 'Rejected attempt alert count', helper: 'Alert after this many rejected funding attempts in the lookback window.', placeholder: 'No alert' },
  { key: 'repeatedFailureLookbackMinutes', label: 'Failure lookback minutes', helper: 'Window used for rejected attempt alerts. Defaults to 60 minutes.', placeholder: '60' },
  { key: 'alertDedupeMinutes', label: 'Alert dedupe minutes', helper: 'Suppress duplicate threshold alerts for this many minutes. Defaults to 60 minutes.', placeholder: '60' },
];

function formatWalletType(type: string): string {
  return type === 'multi_sig' ? 'Multisig' : type === 'single_sig' ? 'Single sig' : type;
}

function formatLimit(value: string | null): string {
  if (!value) return 'No cap';
  try {
    return `${BigInt(value).toLocaleString()} sats`;
  } catch {
    return `${value} sats`;
  }
}

function formatAlertLimit(value: string | null): string {
  if (!value) return 'Off';
  return formatLimit(value);
}

function formatNumberLimit(value: number | null, suffix: string): string {
  if (!value) return 'Off';
  return `${value.toLocaleString()} ${suffix}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

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

function walletBelongsToUser(wallet: AgentOptionWallet, userId: string): boolean {
  return wallet.accessUserIds.includes(userId);
}

function getStatusBadge(agent: WalletAgentMetadata) {
  if (agent.status === 'active' && !agent.revokedAt) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
        <Check className="w-3 h-3" />
        Active
      </span>
    );
  }

  if (agent.status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
        <PauseCircle className="w-3 h-3" />
        Paused
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
      <AlertTriangle className="w-3 h-3" />
      Revoked
    </span>
  );
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

function AgentRow({
  agent,
  busyAction,
  onEdit,
  onRevoke,
  onOpenKeys,
  onRevokeKey,
}: {
  agent: WalletAgentMetadata;
  busyAction: string | null;
  onEdit: (agent: WalletAgentMetadata) => void;
  onRevoke: (agent: WalletAgentMetadata) => void;
  onOpenKeys: (agent: WalletAgentMetadata) => void;
  onRevokeKey: (agent: WalletAgentMetadata, keyId: string) => void;
}) {
  const activeKeys = (agent.apiKeys ?? []).filter(key => !key.revokedAt);

  return (
    <div className="p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="w-4 h-4 text-shared-600 dark:text-shared-300" />
            <h3 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{agent.name}</h3>
            {getStatusBadge(agent)}
            {agent.pauseOnUnexpectedSpend && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="w-3 h-3" />
                Auto-pause on spend
              </span>
            )}
          </div>

          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
            <InfoBlock label="User" value={agent.user?.username ?? agent.userId} />
            <InfoBlock label="Funding wallet" value={agent.fundingWallet?.name ?? agent.fundingWalletId} helper={agent.fundingWallet ? formatWalletType(agent.fundingWallet.type) : undefined} />
            <InfoBlock label="Operational wallet" value={agent.operationalWallet?.name ?? agent.operationalWalletId} helper={agent.operationalWallet ? formatWalletType(agent.operationalWallet.type) : undefined} />
            <InfoBlock label="Signer" value={agent.signerDevice?.label ?? agent.signerDeviceId} helper={agent.signerDevice?.fingerprint} />
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
            <span>Request cap: {formatLimit(agent.maxFundingAmountSats)}</span>
            <span>Balance cap: {formatLimit(agent.maxOperationalBalanceSats)}</span>
            <span>Daily cap: {formatLimit(agent.dailyFundingLimitSats)}</span>
            <span>Weekly cap: {formatLimit(agent.weeklyFundingLimitSats)}</span>
            <span>Cooldown: {agent.cooldownMinutes ?? 0} min</span>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
            <span>Refill alert: {formatAlertLimit(agent.minOperationalBalanceSats)}</span>
            <span>Large spend: {formatAlertLimit(agent.largeOperationalSpendSats)}</span>
            <span>Large fee: {formatAlertLimit(agent.largeOperationalFeeSats)}</span>
            <span>Failure alerts: {formatNumberLimit(agent.repeatedFailureThreshold, 'rejects')}</span>
            <span>Dedupe: {agent.alertDedupeMinutes ? `${agent.alertDedupeMinutes} min` : 'Default'}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
            <span>{activeKeys.length} active key{activeKeys.length === 1 ? '' : 's'}</span>
            <span>Last draft: {formatDateTime(agent.lastFundingDraftAt)}</span>
            <span>Created: {formatDateTime(agent.createdAt)}</span>
          </div>

          {activeKeys.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeKeys.map(key => (
                <span key={key.id} className="inline-flex items-center gap-2 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 px-2 py-1 text-xs text-sanctuary-600 dark:text-sanctuary-300">
                  <KeyRound className="w-3 h-3" />
                  {key.name} · {key.keyPrefix}
                  <button
                    type="button"
                    className="text-rose-500 hover:text-rose-600 dark:text-rose-300 dark:hover:text-rose-200"
                    onClick={() => onRevokeKey(agent, key.id)}
                  >
                    Revoke
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button variant="secondary" size="sm" onClick={() => onEdit(agent)}>
            Edit
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onOpenKeys(agent)} disabled={agent.status === 'revoked' || Boolean(agent.revokedAt)}>
            Issue Key
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onRevoke(agent)}
            isLoading={busyAction === `revoke-${agent.id}`}
            disabled={agent.status === 'revoked' || Boolean(agent.revokedAt)}
          >
            Revoke
          </Button>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-sanctuary-400">{label}</div>
      <div className="truncate text-sanctuary-800 dark:text-sanctuary-200">{value}</div>
      {helper && <div className="truncate text-xs text-sanctuary-500 dark:text-sanctuary-400">{helper}</div>}
    </div>
  );
}

function AgentFormModal({
  title,
  agent,
  options,
  isSaving,
  onClose,
  onSubmit,
}: {
  title: string;
  agent?: WalletAgentMetadata;
  options: AgentManagementOptions;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (form: AgentFormState) => Promise<void>;
}) {
  const [form, setForm] = useState<AgentFormState>(() => agent ? {
    ...DEFAULT_AGENT_FORM,
    name: agent.name,
    userId: agent.userId,
    fundingWalletId: agent.fundingWalletId,
    operationalWalletId: agent.operationalWalletId,
    signerDeviceId: agent.signerDeviceId,
    status: agent.status,
    maxFundingAmountSats: agent.maxFundingAmountSats ?? '',
    maxOperationalBalanceSats: agent.maxOperationalBalanceSats ?? '',
    dailyFundingLimitSats: agent.dailyFundingLimitSats ?? '',
    weeklyFundingLimitSats: agent.weeklyFundingLimitSats ?? '',
    cooldownMinutes: agent.cooldownMinutes?.toString() ?? '',
    minOperationalBalanceSats: agent.minOperationalBalanceSats ?? '',
    largeOperationalSpendSats: agent.largeOperationalSpendSats ?? '',
    largeOperationalFeeSats: agent.largeOperationalFeeSats ?? '',
    repeatedFailureThreshold: agent.repeatedFailureThreshold?.toString() ?? '',
    repeatedFailureLookbackMinutes: agent.repeatedFailureLookbackMinutes?.toString() ?? '',
    alertDedupeMinutes: agent.alertDedupeMinutes?.toString() ?? '',
    requireHumanApproval: agent.requireHumanApproval,
    notifyOnOperationalSpend: agent.notifyOnOperationalSpend,
    pauseOnUnexpectedSpend: agent.pauseOnUnexpectedSpend,
  } : DEFAULT_AGENT_FORM);

  const selectedFundingWallet = useMemo(
    () => options.wallets.find(wallet => wallet.id === form.fundingWalletId),
    [form.fundingWalletId, options.wallets]
  );
  const fundingWallets = useMemo(
    () => options.wallets.filter(wallet =>
      wallet.type === 'multi_sig' && (!form.userId || walletBelongsToUser(wallet, form.userId))
    ),
    [form.userId, options.wallets]
  );
  const operationalWallets = useMemo(
    () => options.wallets.filter(wallet =>
      wallet.type === 'single_sig' &&
      wallet.id !== form.fundingWalletId &&
      (!form.userId || walletBelongsToUser(wallet, form.userId)) &&
      (!selectedFundingWallet || wallet.network === selectedFundingWallet.network)
    ),
    [form.fundingWalletId, form.userId, options.wallets, selectedFundingWallet]
  );
  const signerDevices = useMemo(
    () => options.devices.filter(device =>
      !form.fundingWalletId || device.walletIds.includes(form.fundingWalletId)
    ),
    [form.fundingWalletId, options.devices]
  );
  const canSubmit = Boolean(
    form.name.trim() &&
    form.userId &&
    form.fundingWalletId &&
    form.operationalWalletId &&
    form.signerDeviceId
  );

  useEffect(() => {
    // Upstream user/funding choices constrain downstream wallet and signer selections.
    if (form.fundingWalletId && !fundingWallets.some(wallet => wallet.id === form.fundingWalletId)) {
      setForm(current => ({ ...current, fundingWalletId: '', signerDeviceId: '', operationalWalletId: '' }));
      return;
    }

    if (form.operationalWalletId && !operationalWallets.some(wallet => wallet.id === form.operationalWalletId)) {
      setForm(current => ({ ...current, operationalWalletId: '' }));
    }

    if (form.signerDeviceId && !signerDevices.some(device => device.id === form.signerDeviceId)) {
      setForm(current => ({ ...current, signerDeviceId: '' }));
    }
  }, [form.userId, form.fundingWalletId, form.operationalWalletId, form.signerDeviceId, fundingWallets, operationalWallets, signerDevices]);

  const setField = <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  return (
    <ModalWrapper title={title} onClose={onClose} maxWidth="2xl" headerBorder>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Agent name *</label>
          <Input value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="Treasury funding agent" autoFocus />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SelectField
            label="Target user *"
            value={form.userId}
            disabled={Boolean(agent)}
            onChange={(value) => setForm(current => ({ ...current, userId: value, fundingWalletId: '', operationalWalletId: '', signerDeviceId: '' }))}
            options={options.users.map(user => ({ value: user.id, label: user.username }))}
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={(value) => setField('status', value as WalletAgentStatus)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
              { value: 'revoked', label: 'Revoked' },
            ]}
          />
          <SelectField
            label="Funding wallet *"
            value={form.fundingWalletId}
            disabled={Boolean(agent) || !form.userId}
            onChange={(value) => setForm(current => ({ ...current, fundingWalletId: value, operationalWalletId: '', signerDeviceId: '' }))}
            options={fundingWallets.map(wallet => ({ value: wallet.id, label: `${wallet.name} · ${wallet.network}` }))}
          />
          <SelectField
            label="Operational wallet *"
            value={form.operationalWalletId}
            disabled={Boolean(agent) || !form.fundingWalletId}
            onChange={(value) => setField('operationalWalletId', value)}
            options={operationalWallets.map(wallet => ({ value: wallet.id, label: `${wallet.name} · ${wallet.network}` }))}
          />
          <SelectField
            label="Agent signer device *"
            value={form.signerDeviceId}
            disabled={Boolean(agent) || !form.fundingWalletId}
            onChange={(value) => setField('signerDeviceId', value)}
            options={signerDevices.map(device => ({ value: device.id, label: `${device.label} · ${device.fingerprint}` }))}
          />
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Cooldown minutes</label>
            <Input
              type="number"
              min={0}
              aria-label="Cooldown minutes"
              value={form.cooldownMinutes}
              onChange={(event) => setField('cooldownMinutes', event.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {POLICY_FIELDS.map(field => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{field.label}</label>
              <Input
                type="number"
                min={0}
                aria-label={field.label}
                value={form[field.key]}
                onChange={(event) => setField(field.key, event.target.value)}
                placeholder="No cap"
              />
              <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">{field.helper}</p>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
          <div>
            <h3 className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">Operational alerts</h3>
            <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">
              Persist alert history for balance drift, large operational transactions, and repeated rejected funding attempts.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MONITORING_SATS_FIELDS.map(field => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{field.label}</label>
                <Input
                  type="number"
                  min={0}
                  aria-label={field.label}
                  value={form[field.key]}
                  onChange={(event) => setField(field.key, event.target.value)}
                  placeholder="Off"
                />
                <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">{field.helper}</p>
              </div>
            ))}
            {MONITORING_NUMBER_FIELDS.map(field => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{field.label}</label>
                <Input
                  type="number"
                  min={1}
                  aria-label={field.label}
                  value={form[field.key]}
                  onChange={(event) => setField(field.key, event.target.value)}
                  placeholder={field.placeholder}
                />
                <p className="mt-1 text-xs text-sanctuary-500 dark:text-sanctuary-400">{field.helper}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
          <ToggleRow label="Human multisig approval required" checked={form.requireHumanApproval} onChange={(value) => setField('requireHumanApproval', value)} disabled />
          <ToggleRow label="Notify on operational spend" checked={form.notifyOnOperationalSpend} onChange={(value) => setField('notifyOnOperationalSpend', value)} />
          <ToggleRow label="Pause future funding after operational spend" checked={form.pauseOnUnexpectedSpend} onChange={(value) => setField('pauseOnUnexpectedSpend', value)} color="warning" />
        </div>

        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Once funded, the operational wallet can spend without multisig approval. These settings only gate future funding and notifications.</span>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit(form)} isLoading={isSaving} disabled={!canSubmit}>
          {agent ? 'Save Agent' : 'Create Agent'}
        </Button>
      </div>
    </ModalWrapper>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
      >
        <option value="">Select...</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  color,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: 'primary' | 'success' | 'warning';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} color={color} />
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
