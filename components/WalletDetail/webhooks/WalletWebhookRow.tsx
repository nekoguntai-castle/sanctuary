import { Clock3, KeyRound, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { WalletWebhookDelivery, WalletWebhookEndpoint } from '../../../types';
import { Alert, IconTextButton } from './controls';
import { formatTimestamp, inputClassName } from './model';

export interface DeliveryState {
  loading: boolean;
  deliveries: WalletWebhookDelivery[];
  error: string | null;
}

export function WalletWebhookRow({
  webhook,
  deliveries,
  secretValue,
  busyAction,
  onToggle,
  onTest,
  onLoadDeliveries,
  onReplay,
  onSecretChange,
  onRotateSecret,
  onDelete,
}: {
  webhook: WalletWebhookEndpoint;
  deliveries?: DeliveryState;
  secretValue: string;
  busyAction: string | null;
  onToggle: () => void;
  onTest: () => void;
  onLoadDeliveries: () => void;
  onReplay: (delivery: WalletWebhookDelivery) => void;
  onSecretChange: (value: string) => void;
  onRotateSecret: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{webhook.name}</div>
          <div className="text-sm text-sanctuary-500 truncate">{webhook.url}</div>
        </div>
        <IconTextButton onClick={onTest} busy={busyAction === `test:${webhook.id}`} icon={<Play className="w-4 h-4" />}>
          Test
        </IconTextButton>
        <IconTextButton onClick={onLoadDeliveries} busy={deliveries?.loading === true} icon={<Clock3 className="w-4 h-4" />}>
          History
        </IconTextButton>
        <button
          type="button"
          onClick={onToggle}
          disabled={busyAction === `toggle:${webhook.id}`}
          className="px-3 py-1.5 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 text-sm text-sanctuary-700 dark:text-sanctuary-300 disabled:opacity-50"
        >
          {webhook.enabled ? 'Enabled' : 'Disabled'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busyAction === `delete:${webhook.id}`}
          className="p-2 text-sanctuary-500 hover:text-error-600 disabled:opacity-50"
          aria-label={`Delete ${webhook.name}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="text-xs text-sanctuary-500">
        {webhook.payloadProfile} · {webhook.authType} · attempts {webhook.maxAttempts}
        {webhook.lastDeliveryStatus ? ` · last ${webhook.lastDeliveryStatus}` : ''}
        {webhook.hasSecret ? ' · secret stored' : ''}
      </div>
      {webhook.lastError && (
        <div className="text-xs text-error-600 dark:text-error-400">{webhook.lastError}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={secretValue}
          onChange={(event) => onSecretChange(event.target.value)}
          placeholder="Rotate signing secret"
          type="password"
          className={`${inputClassName} max-w-xs`}
        />
        <IconTextButton
          onClick={onRotateSecret}
          busy={busyAction === `secret:${webhook.id}`}
          disabled={!secretValue.trim()}
          icon={<KeyRound className="w-4 h-4" />}
        >
          Rotate
        </IconTextButton>
      </div>

      {deliveries?.error && <Alert tone="error">{deliveries.error}</Alert>}
      {deliveries && deliveries.deliveries.length > 0 && (
        <DeliveryTable
          deliveries={deliveries.deliveries}
          busyAction={busyAction}
          onReplay={onReplay}
        />
      )}
      {deliveries && !deliveries.loading && deliveries.deliveries.length === 0 && (
        <p className="text-xs text-sanctuary-500">No deliveries yet.</p>
      )}
    </div>
  );
}

function DeliveryTable({
  deliveries,
  busyAction,
  onReplay,
}: {
  deliveries: WalletWebhookDelivery[];
  busyAction: string | null;
  onReplay: (delivery: WalletWebhookDelivery) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="text-sanctuary-500">
          <tr>
            <th className="text-left font-medium py-2 pr-3">Status</th>
            <th className="text-left font-medium py-2 pr-3">Event</th>
            <th className="text-left font-medium py-2 pr-3">Attempts</th>
            <th className="text-left font-medium py-2 pr-3">HTTP</th>
            <th className="text-left font-medium py-2 pr-3">Last attempt</th>
            <th className="text-right font-medium py-2 pl-3">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
          {deliveries.map(delivery => (
            <tr key={delivery.id}>
              <td className="py-2 pr-3">{delivery.status}</td>
              <td className="py-2 pr-3 max-w-[18rem] truncate">{delivery.eventId}</td>
              <td className="py-2 pr-3">{delivery.attemptCount}</td>
              <td className="py-2 pr-3">{delivery.lastStatusCode ?? '-'}</td>
              <td className="py-2 pr-3">{formatTimestamp(delivery.lastAttemptAt ?? delivery.createdAt)}</td>
              <td className="py-2 pl-3 text-right">
                <button
                  type="button"
                  onClick={() => onReplay(delivery)}
                  disabled={busyAction === `replay:${delivery.id}`}
                  className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Replay
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
