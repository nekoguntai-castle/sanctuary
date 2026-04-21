import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type { AgentFundingOverrideMetadata, WalletAgentMetadata } from '../../src/api/admin';
import { extractErrorMessage } from '../../utils/errorHandler';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { ModalWrapper } from '../ui/ModalWrapper';
import { formatDateTime, formatLimit } from './formatters';

interface OverrideFormState {
  maxAmountSats: string;
  expiresAt: string;
  reason: string;
}

interface CreateOverridePayload {
  expiresAt: string;
  maxAmountSats: string;
  reason: string;
}

const EMPTY_OVERRIDE_FORM: OverrideFormState = {
  maxAmountSats: '',
  expiresAt: '',
  reason: '',
};

function createOverridePayload(form: OverrideFormState): {
  error: string | null;
  payload: CreateOverridePayload | null;
} {
  const maxAmountSats = form.maxAmountSats.trim();
  const reason = form.reason.trim();
  const parsedExpiresAt = new Date(form.expiresAt);

  /* v8 ignore next 3 -- the submit button is disabled until both fields are non-empty */
  if (!maxAmountSats || !reason) {
    return { error: 'Enter an amount and reason', payload: null };
  }
  /* v8 ignore next 3 -- datetime-local input only provides parseable values when enabled */
  if (Number.isNaN(parsedExpiresAt.getTime())) {
    return { error: 'Enter a valid expiration date', payload: null };
  }

  return {
    error: null,
    payload: {
      maxAmountSats,
      expiresAt: parsedExpiresAt.toISOString(),
      reason,
    },
  };
}

function getActiveOverrideCount(overrides: AgentFundingOverrideMetadata[]): number {
  return overrides.filter(isUsableOverride).length;
}

function useAgentOverrideModalState(agentId: string) {
  const [overrides, setOverrides] = useState<AgentFundingOverrideMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [form, setForm] = useState<OverrideFormState>(EMPTY_OVERRIDE_FORM);

  const loadOverrides = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverrides(await adminApi.getAgentFundingOverrides(agentId));
    } catch (loadError) {
      setError(extractErrorMessage(loadError, 'Failed to load funding overrides'));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  const updateFormField = useCallback(
    <Key extends keyof OverrideFormState>(key: Key, value: OverrideFormState[Key]) => {
      setForm(current => ({ ...current, [key]: value }));
    },
    []
  );

  const handleCreate = useCallback(async () => {
    const { error: validationError, payload } = createOverridePayload(form);
    /* v8 ignore next 4 -- invalid payloads are blocked by disabled form controls */
    if (!payload) {
      setError(validationError);
      return;
    }

    setBusyAction('create-override');
    setError(null);
    try {
      await adminApi.createAgentFundingOverride(agentId, payload);
      setForm(EMPTY_OVERRIDE_FORM);
      await loadOverrides();
    } catch (createError) {
      setError(extractErrorMessage(createError, 'Failed to create funding override'));
    } finally {
      setBusyAction(null);
    }
  }, [agentId, form, loadOverrides]);

  const handleRevoke = useCallback(async (override: AgentFundingOverrideMetadata) => {
    if (!confirm('Revoke this funding override?')) return;
    setBusyAction(`revoke-override-${override.id}`);
    setError(null);
    try {
      await adminApi.revokeAgentFundingOverride(agentId, override.id);
      await loadOverrides();
    } catch (revokeError) {
      setError(extractErrorMessage(revokeError, 'Failed to revoke funding override'));
    } finally {
      setBusyAction(null);
    }
  }, [agentId, loadOverrides]);

  return {
    overrides,
    loading,
    error,
    busyAction,
    form,
    updateFormField,
    handleCreate,
    handleRevoke,
  };
}

export function AgentOverridesModal({
  agent,
  onClose,
}: {
  agent: WalletAgentMetadata;
  onClose: () => void;
}) {
  const {
    overrides,
    loading,
    error,
    busyAction,
    form,
    updateFormField,
    handleCreate,
    handleRevoke,
  } = useAgentOverrideModalState(agent.id);
  const activeOverrideCount = getActiveOverrideCount(overrides);

  return (
    <ModalWrapper title={`Funding overrides for ${agent.name}`} onClose={onClose} maxWidth="2xl" headerBorder>
      <div className="space-y-5">
        <ErrorAlert message={error} />

        <OverridePolicyNotice />
        <OverrideFormSection
          form={form}
          busyAction={busyAction}
          onCreate={handleCreate}
          onFieldChange={updateFormField}
        />
        <OverrideHistorySection
          overrides={overrides}
          loading={loading}
          busyAction={busyAction}
          activeOverrideCount={activeOverrideCount}
          onRevoke={handleRevoke}
        />
      </div>
    </ModalWrapper>
  );
}

function OverridePolicyNotice() {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
      <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>Owner overrides are one-time funding windows for cap exceptions. Agent credentials cannot create, extend, or revoke them.</span>
    </div>
  );
}

function OverrideFormSection({
  form,
  busyAction,
  onCreate,
  onFieldChange,
}: {
  form: OverrideFormState;
  busyAction: string | null;
  onCreate: () => Promise<void>;
  onFieldChange: <Key extends keyof OverrideFormState>(key: Key, value: OverrideFormState[Key]) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <OverrideFormField label="Maximum sats *">
          <Input
            type="number"
            min={1}
            aria-label="Maximum sats"
            value={form.maxAmountSats}
            onChange={(event) => onFieldChange('maxAmountSats', event.target.value)}
            placeholder="250000"
          />
        </OverrideFormField>
        <OverrideFormField label="Expires at *">
          <Input
            type="datetime-local"
            aria-label="Expires at"
            value={form.expiresAt}
            onChange={(event) => onFieldChange('expiresAt', event.target.value)}
          />
        </OverrideFormField>
        <OverrideFormField label="Reason *">
          <Input
            aria-label="Reason"
            value={form.reason}
            onChange={(event) => onFieldChange('reason', event.target.value)}
            placeholder="Emergency refill"
          />
        </OverrideFormField>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => void onCreate()}
          isLoading={busyAction === 'create-override'}
          disabled={!form.maxAmountSats.trim() || !form.expiresAt.trim() || !form.reason.trim()}
        >
          Create Override
        </Button>
      </div>
    </>
  );
}

function OverrideFormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{label}</label>
      {children}
    </div>
  );
}

function OverrideHistorySection({
  overrides,
  loading,
  busyAction,
  activeOverrideCount,
  onRevoke,
}: {
  overrides: AgentFundingOverrideMetadata[];
  loading: boolean;
  busyAction: string | null;
  activeOverrideCount: number;
  onRevoke: (override: AgentFundingOverrideMetadata) => Promise<void>;
}) {
  return (
    <div className="border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">Override history</h3>
        <span className="text-xs text-sanctuary-500">{activeOverrideCount} active</span>
      </div>
      {loading ? (
        <OverrideLoadingState />
      ) : overrides.length === 0 ? (
        <div className="text-sm text-sanctuary-500">No owner overrides created.</div>
      ) : (
        <div className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
          {overrides.map(override => (
            <OverrideHistoryRow
              key={override.id}
              override={override}
              busyAction={busyAction}
              onRevoke={onRevoke}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OverrideLoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-sanctuary-500">
      <Loader2 className="w-4 h-4 animate-spin" />
      Loading overrides
    </div>
  );
}

function OverrideHistoryRow({
  override,
  busyAction,
  onRevoke,
}: {
  override: AgentFundingOverrideMetadata;
  busyAction: string | null;
  onRevoke: (override: AgentFundingOverrideMetadata) => Promise<void>;
}) {
  return (
    <div className="py-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{formatLimit(override.maxAmountSats)}</span>
          <OverrideStatusBadge override={override} />
        </div>
        <div className="mt-1 text-sm text-sanctuary-600 dark:text-sanctuary-300">{override.reason}</div>
        <div className="mt-1 text-xs text-sanctuary-500">
          Expires: {formatDateTime(override.expiresAt)}
          {override.usedDraftId ? ` · Used draft: ${override.usedDraftId}` : ''}
        </div>
      </div>
      <OverrideRevokeButton
        override={override}
        busyAction={busyAction}
        onRevoke={onRevoke}
      />
    </div>
  );
}

function OverrideRevokeButton({
  override,
  busyAction,
  onRevoke,
}: {
  override: AgentFundingOverrideMetadata;
  busyAction: string | null;
  onRevoke: (override: AgentFundingOverrideMetadata) => Promise<void>;
}) {
  if (override.status !== 'active' || override.revokedAt || override.usedAt) {
    return null;
  }

  return (
    <Button
      variant="danger"
      size="sm"
      onClick={() => void onRevoke(override)}
      isLoading={busyAction === `revoke-override-${override.id}`}
    >
      Revoke
    </Button>
  );
}

function OverrideStatusBadge({ override }: { override: AgentFundingOverrideMetadata }) {
  if (override.status === 'used' || override.usedAt) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
        Used
      </span>
    );
  }
  if (override.status === 'revoked' || override.revokedAt) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
        Revoked
      </span>
    );
  }
  if (isOverrideExpired(override)) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
      Active
    </span>
  );
}

function isUsableOverride(override: AgentFundingOverrideMetadata): boolean {
  return override.status === 'active' && !override.revokedAt && !override.usedAt && !isOverrideExpired(override);
}

function isOverrideExpired(override: AgentFundingOverrideMetadata): boolean {
  const expiresAt = new Date(override.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}
