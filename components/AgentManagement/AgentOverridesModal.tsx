import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type { AgentFundingOverrideMetadata, WalletAgentMetadata } from '../../src/api/admin';
import { extractErrorMessage } from '../../utils/errorHandler';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { ModalWrapper } from '../ui/ModalWrapper';
import { formatDateTime, formatLimit } from './formatters';

export function AgentOverridesModal({
  agent,
  onClose,
}: {
  agent: WalletAgentMetadata;
  onClose: () => void;
}) {
  const [overrides, setOverrides] = useState<AgentFundingOverrideMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [maxAmountSats, setMaxAmountSats] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');

  const loadOverrides = async () => {
    setLoading(true);
    setError(null);
    try {
      setOverrides(await adminApi.getAgentFundingOverrides(agent.id));
    } catch (loadError) {
      setError(extractErrorMessage(loadError, 'Failed to load funding overrides'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOverrides();
  }, [agent.id]);

  const handleCreate = async () => {
    const trimmedAmount = maxAmountSats.trim();
    const trimmedReason = reason.trim();
    const parsedExpiresAt = new Date(expiresAt);
    if (!trimmedAmount || !trimmedReason) {
      setError('Enter an amount and reason');
      return;
    }
    if (Number.isNaN(parsedExpiresAt.getTime())) {
      setError('Enter a valid expiration date');
      return;
    }

    setBusyAction('create-override');
    setError(null);
    try {
      await adminApi.createAgentFundingOverride(agent.id, {
        maxAmountSats: trimmedAmount,
        expiresAt: parsedExpiresAt.toISOString(),
        reason: trimmedReason,
      });
      setMaxAmountSats('');
      setExpiresAt('');
      setReason('');
      await loadOverrides();
    } catch (createError) {
      setError(extractErrorMessage(createError, 'Failed to create funding override'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevoke = async (override: AgentFundingOverrideMetadata) => {
    if (!confirm('Revoke this funding override?')) return;
    setBusyAction(`revoke-override-${override.id}`);
    setError(null);
    try {
      await adminApi.revokeAgentFundingOverride(agent.id, override.id);
      await loadOverrides();
    } catch (revokeError) {
      setError(extractErrorMessage(revokeError, 'Failed to revoke funding override'));
    } finally {
      setBusyAction(null);
    }
  };

  const activeOverrides = overrides.filter(isUsableOverride);

  return (
    <ModalWrapper title={`Funding overrides for ${agent.name}`} onClose={onClose} maxWidth="2xl" headerBorder>
      <div className="space-y-5">
        <ErrorAlert message={error} />

        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
          <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Owner overrides are one-time funding windows for cap exceptions. Agent credentials cannot create, extend, or revoke them.</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Maximum sats *</label>
            <Input
              type="number"
              min={1}
              aria-label="Maximum sats"
              value={maxAmountSats}
              onChange={(event) => setMaxAmountSats(event.target.value)}
              placeholder="250000"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Expires at *</label>
            <Input
              type="datetime-local"
              aria-label="Expires at"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Reason *</label>
            <Input
              aria-label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Emergency refill"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleCreate}
            isLoading={busyAction === 'create-override'}
            disabled={!maxAmountSats.trim() || !expiresAt.trim() || !reason.trim()}
          >
            Create Override
          </Button>
        </div>

        <div className="border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">Override history</h3>
            <span className="text-xs text-sanctuary-500">{activeOverrides.length} active</span>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-sanctuary-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading overrides
            </div>
          ) : overrides.length === 0 ? (
            <div className="text-sm text-sanctuary-500">No owner overrides created.</div>
          ) : (
            <div className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
              {overrides.map(override => (
                <div key={override.id} className="py-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
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
                  {override.status === 'active' && !override.revokedAt && !override.usedAt && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleRevoke(override)}
                      isLoading={busyAction === `revoke-override-${override.id}`}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalWrapper>
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
