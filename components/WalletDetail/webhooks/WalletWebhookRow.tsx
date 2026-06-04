import { Clock3, KeyRound, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { WalletWebhookDelivery, WalletWebhookEndpoint } from '../../../types';
import { Alert, IconTextButton } from './controls';
import { formatTimestamp, inputClassName } from './model';

export interface DeliveryState {
  loading: boolean;
  deliveries: WalletWebhookDelivery[];
  error: string | null;
}

type WalletWebhookRowProps = {
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
};

type WebhookHeaderProps = {
  webhook: WalletWebhookEndpoint;
  deliveries?: DeliveryState;
  busyAction: string | null;
  onToggle: () => void;
  onTest: () => void;
  onLoadDeliveries: () => void;
  onDelete: () => void;
};

type SecretRotationProps = {
  webhook: WalletWebhookEndpoint;
  secretValue: string;
  busyAction: string | null;
  onSecretChange: (value: string) => void;
  onRotateSecret: () => void;
};

type DeliveryPanelProps = {
  deliveries?: DeliveryState;
  busyAction: string | null;
  onReplay: (delivery: WalletWebhookDelivery) => void;
};

const isDeliveryHistoryBusy = (deliveries: DeliveryState | undefined) => deliveries?.loading === true;

const getToggleLabel = (enabled: boolean) => enabled ? 'Enabled' : 'Disabled';

const getWebhookMetadata = (webhook: WalletWebhookEndpoint) => {
  const parts = [
    `${webhook.payloadProfile} · ${webhook.authType} · attempts ${webhook.maxAttempts}`,
  ];

  if (webhook.lastDeliveryStatus) parts.push(`last ${webhook.lastDeliveryStatus}`);
  if (webhook.hasSecret) parts.push('secret stored');

  return parts.join(' · ');
};

const hasSecretInput = (secretValue: string) => secretValue.trim().length > 0;

const getDeliveryStatusCode = (delivery: WalletWebhookDelivery) => delivery.lastStatusCode ?? '-';

const getDeliveryAttemptTimestamp = (delivery: WalletWebhookDelivery) => (
  formatTimestamp(delivery.lastAttemptAt ?? delivery.createdAt)
);

const WebhookHeader = ({
  webhook,
  deliveries,
  busyAction,
  onToggle,
  onTest,
  onLoadDeliveries,
  onDelete,
}: WebhookHeaderProps) => (
  <div className="flex flex-wrap items-start gap-3">
    <div className="min-w-0 flex-1">
      <div className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{webhook.name}</div>
      <div className="text-sm text-sanctuary-500 truncate">{webhook.url}</div>
    </div>
    <IconTextButton onClick={onTest} busy={busyAction === `test:${webhook.id}`} icon={<Play className="w-4 h-4" />}>
      Test
    </IconTextButton>
    <IconTextButton onClick={onLoadDeliveries} busy={isDeliveryHistoryBusy(deliveries)} icon={<Clock3 className="w-4 h-4" />}>
      History
    </IconTextButton>
    <button
      type="button"
      onClick={onToggle}
      disabled={busyAction === `toggle:${webhook.id}`}
      className="px-3 py-1.5 rounded-md border border-sanctuary-200 dark:border-sanctuary-700 text-sm text-sanctuary-700 dark:text-sanctuary-300 disabled:opacity-50"
    >
      {getToggleLabel(webhook.enabled)}
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
);

const WebhookMetadata = ({ webhook }: { webhook: WalletWebhookEndpoint }) => (
  <div className="text-xs text-sanctuary-500">
    {getWebhookMetadata(webhook)}
  </div>
);

const WebhookLastError = ({ error }: { error: string | null }) => {
  if (!error) return null;

  return (
    <div className="text-xs text-error-600 dark:text-error-400">{error}</div>
  );
};

const SecretRotation = ({
  webhook,
  secretValue,
  busyAction,
  onSecretChange,
  onRotateSecret,
}: SecretRotationProps) => (
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
      disabled={!hasSecretInput(secretValue)}
      icon={<KeyRound className="w-4 h-4" />}
    >
      Rotate
    </IconTextButton>
  </div>
);

const DeliveryPanel = ({
  deliveries,
  busyAction,
  onReplay,
}: DeliveryPanelProps) => {
  if (!deliveries) return null;

  return [
    <DeliveryError key="error" error={deliveries.error} />,
    <DeliveryHistory
      key="history"
      loading={deliveries.loading}
      deliveries={deliveries.deliveries}
      busyAction={busyAction}
      onReplay={onReplay}
    />,
  ];
};

const DeliveryError = ({ error }: { error: string | null }) => {
  if (!error) return null;

  return <Alert tone="error">{error}</Alert>;
};

const DeliveryHistory = ({
  loading,
  deliveries,
  busyAction,
  onReplay,
}: {
  loading: boolean;
  deliveries: WalletWebhookDelivery[];
  busyAction: string | null;
  onReplay: (delivery: WalletWebhookDelivery) => void;
}) => {
  if (deliveries.length > 0) {
    return (
      <DeliveryTable
        deliveries={deliveries}
        busyAction={busyAction}
        onReplay={onReplay}
      />
    );
  }

  if (!loading) return <p className="text-xs text-sanctuary-500">No deliveries yet.</p>;

  return null;
};

const DeliveryTable = ({
  deliveries,
  busyAction,
  onReplay,
}: {
  deliveries: WalletWebhookDelivery[];
  busyAction: string | null;
  onReplay: (delivery: WalletWebhookDelivery) => void;
}) => (
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
          <DeliveryTableRow
            key={delivery.id}
            delivery={delivery}
            busyAction={busyAction}
            onReplay={onReplay}
          />
        ))}
      </tbody>
    </table>
  </div>
);

const DeliveryTableRow = ({
  delivery,
  busyAction,
  onReplay,
}: {
  delivery: WalletWebhookDelivery;
  busyAction: string | null;
  onReplay: (delivery: WalletWebhookDelivery) => void;
}) => (
  <tr>
    <td className="py-2 pr-3">{delivery.status}</td>
    <td className="py-2 pr-3 max-w-[18rem] truncate">{delivery.eventId}</td>
    <td className="py-2 pr-3">{delivery.attemptCount}</td>
    <td className="py-2 pr-3">{getDeliveryStatusCode(delivery)}</td>
    <td className="py-2 pr-3">{getDeliveryAttemptTimestamp(delivery)}</td>
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
);

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
}: WalletWebhookRowProps) {
  return (
    <div className="border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg p-4 space-y-3">
      <WebhookHeader
        webhook={webhook}
        deliveries={deliveries}
        busyAction={busyAction}
        onToggle={onToggle}
        onTest={onTest}
        onLoadDeliveries={onLoadDeliveries}
        onDelete={onDelete}
      />
      <WebhookMetadata webhook={webhook} />
      <WebhookLastError error={webhook.lastError} />
      <SecretRotation
        webhook={webhook}
        secretValue={secretValue}
        busyAction={busyAction}
        onSecretChange={onSecretChange}
        onRotateSecret={onRotateSecret}
      />
      <DeliveryPanel deliveries={deliveries} busyAction={busyAction} onReplay={onReplay} />
    </div>
  );
}
