import { CheckCircle, Loader2, RefreshCw, Shield } from 'lucide-react';
import type { NodeConfig as NodeConfigType } from '../../types';
import * as adminApi from '../../src/api/admin';
import type { ProxyPreset } from './useProxyTorControls';

export function BundledTorContainerCard({
  nodeConfig,
  torContainerStatus,
  isTorContainerLoading,
  torContainerMessage,
  onProxyPreset,
  onTorContainerToggle,
  onRefreshTorStatus,
}: {
  nodeConfig: NodeConfigType;
  torContainerStatus: adminApi.TorContainerStatus | null;
  isTorContainerLoading: boolean;
  torContainerMessage: string;
  onProxyPreset: (preset: ProxyPreset) => void;
  onTorContainerToggle: () => void;
  onRefreshTorStatus: () => void;
}) {
  if (!torContainerStatus?.available) return null;

  return (
    <div className={`p-3 rounded-lg border ${bundledTorCardClass(nodeConfig)}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Shield className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          <div>
            <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Bundled Tor</span>
            <p className="text-xs text-sanctuary-500">{torContainerStateLabel(torContainerStatus)}</p>
          </div>
        </div>
        <TorContainerActions
          nodeConfig={nodeConfig}
          torContainerStatus={torContainerStatus}
          isTorContainerLoading={isTorContainerLoading}
          onProxyPreset={onProxyPreset}
          onTorContainerToggle={onTorContainerToggle}
          onRefreshTorStatus={onRefreshTorStatus}
        />
      </div>
      <TorContainerMessage
        torContainerStatus={torContainerStatus}
        torContainerMessage={torContainerMessage}
      />
    </div>
  );
}

function TorContainerActions({
  nodeConfig,
  torContainerStatus,
  isTorContainerLoading,
  onProxyPreset,
  onTorContainerToggle,
  onRefreshTorStatus,
}: {
  nodeConfig: NodeConfigType;
  torContainerStatus: adminApi.TorContainerStatus;
  isTorContainerLoading: boolean;
  onProxyPreset: (preset: ProxyPreset) => void;
  onTorContainerToggle: () => void;
  onRefreshTorStatus: () => void;
}) {
  return (
    <div className="flex items-center space-x-2">
      {torContainerStatus.running && nodeConfig.proxyHost !== 'tor' && (
        <button
          onClick={() => onProxyPreset('tor-container')}
          className="text-xs px-2 py-1 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200"
        >
          Use
        </button>
      )}
      {nodeConfig.proxyHost === 'tor' && torContainerStatus.running && (
        <CheckCircle className="w-4 h-4 text-violet-600" />
      )}
      <button
        onClick={onRefreshTorStatus}
        className="p-1 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded"
      >
        <RefreshCw className={`w-3.5 h-3.5 text-sanctuary-400 ${isTorContainerLoading ? 'animate-spin' : ''}`} />
      </button>
      <button
        onClick={onTorContainerToggle}
        disabled={isTorContainerLoading}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${torContainerStatus.running ? 'bg-violet-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${torContainerStatus.running ? 'translate-x-5' : 'translate-x-1'}`}>
          {isTorContainerLoading && <Loader2 className="w-3.5 h-3.5 text-violet-600 animate-spin" />}
        </span>
      </button>
    </div>
  );
}

function TorContainerMessage({
  torContainerStatus,
  torContainerMessage,
}: {
  torContainerStatus: adminApi.TorContainerStatus;
  torContainerMessage: string;
}) {
  if (torContainerMessage) {
    return (
      <p className={`text-xs mt-2 ${torContainerMessageClass(torContainerMessage)}`}>
        {torContainerMessage}
      </p>
    );
  }

  if (!torContainerStatus.running && torContainerStatus.exists) {
    return (
      <p className="text-xs mt-2 text-sanctuary-500">
        Starting Tor takes 10-30 seconds to connect to the network.
      </p>
    );
  }

  return null;
}

function bundledTorCardClass(nodeConfig: NodeConfigType): string {
  return nodeConfig.proxyHost === 'tor'
    ? 'border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/20'
    : 'border-sanctuary-200 dark:border-sanctuary-700';
}

function torContainerStateLabel(torContainerStatus: adminApi.TorContainerStatus): string {
  if (!torContainerStatus.exists) return 'Not installed';
  return torContainerStatus.running ? 'Running' : 'Stopped';
}

function torContainerMessageClass(message: string): string {
  if (message.includes('ready') || message.includes('success')) return 'text-emerald-600 dark:text-emerald-400';
  if (message.includes('bootstrap') || message.includes('10-30s')) return 'text-amber-600 dark:text-amber-400';
  return 'text-sanctuary-600 dark:text-sanctuary-400';
}
