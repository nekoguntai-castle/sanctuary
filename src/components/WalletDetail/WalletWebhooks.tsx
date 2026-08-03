import { useEffect, useMemo, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import { canWalletRoleEdit, parseWalletRole } from '@sanctuary/shared/constants/walletRoles';
import type { WalletWebhookDelivery, WalletWebhookEndpoint } from '../../types';
import * as walletsApi from '../../api/wallets';
import { Alert } from './webhooks/controls';
import { WalletWebhookForm } from './webhooks/WalletWebhookForm';
import { type DeliveryState, WalletWebhookRow } from './webhooks/WalletWebhookRow';
import {
  buildWebhookInput,
  defaultForm,
  parseHeaderConfigUpdate,
  type WebhookFormState,
} from './webhooks/model';

interface WalletWebhooksProps {
  walletId: string;
  userRole: unknown;
}

export function WalletWebhooks({ walletId, userRole }: WalletWebhooksProps) {
  const [webhooks, setWebhooks] = useState<WalletWebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<WebhookFormState>(() => defaultForm());
  const [deliveryState, setDeliveryState] = useState<Record<string, DeliveryState>>({});
  const [secretUpdates, setSecretUpdates] = useState<Record<string, string>>({});
  const [headerUpdates, setHeaderUpdates] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const walletRole = parseWalletRole(userRole);
  const canManage = walletRole === 'owner';
  const canInspectDeliveries = canWalletRoleEdit(walletRole);

  useEffect(() => {
    if (!walletRole) {
      setLoading(false);
      setError('Webhook access is unavailable');
      return;
    }
    void loadWebhooks();
  }, [walletId, walletRole]);

  const canSave = useMemo(() => {
    const hasRequiredFields = form.name.trim() && form.url.trim() && form.eventTypes.trim();
    const authReady = form.authType === 'none' || form.secret.trim();
    return Boolean(hasRequiredFields && authReady);
  }, [form]);

  async function loadWebhooks() {
    /* v8 ignore next -- the effect only invokes loading after parsing a valid wallet role */
    if (!walletRole) return;
    setLoading(true);
    setError(null);
    try {
      setWebhooks(await walletsApi.listWalletWebhooks(walletId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }

  async function createWebhook() {
    /* v8 ignore next -- the form is hidden/disabled unless both capability and validity hold */
    if (!canManage || !canSave) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await walletsApi.createWalletWebhook(walletId, buildWebhookInput(form));
      setForm(defaultForm());
      setNotice('Webhook endpoint added');
      await loadWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save webhook');
    } finally {
      setSaving(false);
    }
  }

  async function toggleWebhook(webhook: WalletWebhookEndpoint) {
    /* v8 ignore next -- non-owners are never rendered the toggle control */
    if (!canManage) return;
    await runEndpointAction(`toggle:${webhook.id}`, 'Failed to update webhook', async () => {
      await walletsApi.updateWalletWebhook(walletId, webhook.id, { enabled: !webhook.enabled });
      await loadWebhooks();
    });
  }

  async function rotateSecret(webhook: WalletWebhookEndpoint) {
    /* v8 ignore next -- non-owners are never rendered the secret control */
    if (!canManage) return;
    const secret = secretUpdates[webhook.id]?.trim();
    /* v8 ignore next -- the rotate action is disabled while the secret is empty */
    if (!secret) return;
    await runEndpointAction(`secret:${webhook.id}`, 'Failed to rotate secret', async () => {
      await walletsApi.updateWalletWebhook(walletId, webhook.id, { secret });
      setSecretUpdates(prev => ({ ...prev, [webhook.id]: '' }));
      setNotice(`Secret rotated for ${webhook.name}`);
      await loadWebhooks();
    });
  }

  async function testWebhook(webhook: WalletWebhookEndpoint) {
    /* v8 ignore next -- non-owners are never rendered the test control */
    if (!canManage) return;
    await runEndpointAction(`test:${webhook.id}`, 'Failed to test webhook', async () => {
      const result = await walletsApi.testWalletWebhook(walletId, webhook.id);
      setNotice(result.message);
    });
  }

  async function loadDeliveries(webhook: WalletWebhookEndpoint) {
    /* v8 ignore next -- roles without edit capability are never rendered history controls */
    if (!canInspectDeliveries) return;
    const currentDeliveries = deliveryState[webhook.id]?.deliveries ?? [];
    setDeliveryState(prev => ({
      ...prev,
      [webhook.id]: { loading: true, deliveries: currentDeliveries, error: null },
    }));
    try {
      const deliveries = await walletsApi.getWalletWebhookDeliveries(walletId, webhook.id, 25);
      setDeliveryState(prev => ({
        ...prev,
        [webhook.id]: { loading: false, deliveries, error: null },
      }));
    } catch (err) {
      setDeliveryState(prev => ({
        ...prev,
        [webhook.id]: {
          loading: false,
          deliveries: currentDeliveries,
          error: err instanceof Error ? err.message : 'Failed to load deliveries',
        },
      }));
    }
  }

  async function replayDelivery(webhook: WalletWebhookEndpoint, delivery: WalletWebhookDelivery) {
    /* v8 ignore next -- roles without edit capability are never rendered replay controls */
    if (!canInspectDeliveries) return;
    await runEndpointAction(`replay:${delivery.id}`, 'Failed to replay delivery', async () => {
      const result = await walletsApi.replayWalletWebhookDelivery(walletId, webhook.id, delivery.id);
      setNotice(result.message);
      await loadDeliveries(webhook);
      await loadWebhooks();
    });
  }

  async function deleteWebhook(webhookId: string) {
    /* v8 ignore next -- non-owners are never rendered the delete control */
    if (!canManage) return;
    await runEndpointAction(`delete:${webhookId}`, 'Failed to delete webhook', async () => {
      await walletsApi.deleteWalletWebhook(walletId, webhookId);
      await loadWebhooks();
    });
  }

  async function updateHeaders(webhook: WalletWebhookEndpoint) {
    /* v8 ignore next -- non-owners are never rendered the header editor */
    if (!canManage) return;
    await runEndpointAction(`headers:${webhook.id}`, 'Failed to update webhook headers', async () => {
      /* v8 ignore next -- the rendered editor always initializes an entry before enabling update */
      const headerConfig = parseHeaderConfigUpdate(headerUpdates[webhook.id] ?? '');
      /* v8 ignore next -- the update action is disabled while the delta editor is empty */
      if (!headerConfig) return;
      await walletsApi.updateWalletWebhook(walletId, webhook.id, { headerConfig });
      setHeaderUpdates(prev => ({ ...prev, [webhook.id]: '' }));
      setNotice(`Headers updated for ${webhook.name}`);
      await loadWebhooks();
    });
  }

  async function runEndpointAction(action: string, fallbackMessage: string, fn: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setBusyAction(action);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center gap-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <Link2 className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Webhooks</h3>
          <button
            type="button"
            onClick={() => void loadWebhooks()}
            className="ml-auto p-2 text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100"
            aria-label="Refresh webhooks"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {canManage && (
          <WalletWebhookForm
            form={form}
            saving={saving}
            canSave={canSave}
            onFormChange={setForm}
            onCreate={() => void createWebhook()}
          />
        )}

        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-sanctuary-500">Loading webhooks...</p>
          ) : webhooks.length === 0 ? (
            <p className="text-sm text-sanctuary-500">No webhooks configured.</p>
          ) : (
            webhooks.map(webhook => (
              <WalletWebhookRow
                key={webhook.id}
                webhook={webhook}
                canManage={canManage}
                canInspectDeliveries={canInspectDeliveries}
                deliveries={deliveryState[webhook.id]}
                secretValue={secretUpdates[webhook.id] ?? ''}
                headerUpdateValue={headerUpdates[webhook.id] ?? ''}
                busyAction={busyAction}
                onToggle={() => void toggleWebhook(webhook)}
                onTest={() => void testWebhook(webhook)}
                onLoadDeliveries={() => void loadDeliveries(webhook)}
                onReplay={(delivery) => void replayDelivery(webhook, delivery)}
                onSecretChange={(value) => setSecretUpdates(prev => ({ ...prev, [webhook.id]: value }))}
                onRotateSecret={() => void rotateSecret(webhook)}
                onHeaderUpdateChange={(value) => setHeaderUpdates(prev => ({ ...prev, [webhook.id]: value }))}
                onUpdateHeaders={() => void updateHeaders(webhook)}
                onDelete={() => void deleteWebhook(webhook.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
