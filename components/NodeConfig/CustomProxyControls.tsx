import type { NodeConfig as NodeConfigType } from '../../types';
import * as adminApi from '../../src/api/admin';
import { Input } from '../ui/Input';
import type { ProxyPreset } from './useProxyTorControls';

export function CustomProxyControls({
  nodeConfig,
  torContainerStatus,
  showCustomProxy,
  onProxyPreset,
  onToggleCustomProxy,
  onConfigChange,
}: {
  nodeConfig: NodeConfigType;
  torContainerStatus: adminApi.TorContainerStatus | null;
  showCustomProxy: boolean;
  onProxyPreset: (preset: ProxyPreset) => void;
  onToggleCustomProxy: () => void;
  onConfigChange: (config: NodeConfigType) => void;
}) {
  if (nodeConfig.proxyHost === 'tor' && torContainerStatus?.running) return null;

  return (
    <>
      <button
        onClick={onToggleCustomProxy}
        className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
      >
        {showCustomProxy ? 'Hide custom proxy settings' : 'Use custom proxy...'}
      </button>

      {showCustomProxy && (
        <CustomProxyFields
          nodeConfig={nodeConfig}
          onProxyPreset={onProxyPreset}
          onConfigChange={onConfigChange}
        />
      )}
    </>
  );
}

function CustomProxyFields({
  nodeConfig,
  onProxyPreset,
  onConfigChange,
}: {
  nodeConfig: NodeConfigType;
  onProxyPreset: (preset: ProxyPreset) => void;
  onConfigChange: (config: NodeConfigType) => void;
}) {
  return (
    <div className="space-y-3 p-3 surface-muted rounded-lg">
      <ProxyPresetButtons nodeConfig={nodeConfig} onProxyPreset={onProxyPreset} />
      <ProxyHostPortFields nodeConfig={nodeConfig} onConfigChange={onConfigChange} />
      <ProxyAuthFields nodeConfig={nodeConfig} onConfigChange={onConfigChange} />
    </div>
  );
}

function ProxyPresetButtons({
  nodeConfig,
  onProxyPreset,
}: {
  nodeConfig: NodeConfigType;
  onProxyPreset: (preset: ProxyPreset) => void;
}) {
  return (
    <div className="flex gap-2">
      <ProxyPresetButton active={isProxyPresetActive(nodeConfig, 9050)} onClick={() => onProxyPreset('tor')}>
        Tor Daemon (9050)
      </ProxyPresetButton>
      <ProxyPresetButton active={isProxyPresetActive(nodeConfig, 9150)} onClick={() => onProxyPreset('tor-browser')}>
        Tor Browser (9150)
      </ProxyPresetButton>
    </div>
  );
}

function ProxyHostPortFields({
  nodeConfig,
  onConfigChange,
}: {
  nodeConfig: NodeConfigType;
  onConfigChange: (config: NodeConfigType) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-2">
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Host</label>
        <Input
          type="text"
          value={nodeConfig.proxyHost || ''}
          onChange={(event) => onConfigChange({ ...nodeConfig, proxyHost: event.target.value })}
          placeholder="127.0.0.1"
          className="font-mono text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-sanctuary-500 mb-1">Port</label>
        <Input
          type="number"
          value={nodeConfig.proxyPort || ''}
          onChange={(event) => onConfigChange({ ...nodeConfig, proxyPort: parseInt(event.target.value, 10) || undefined })}
          placeholder="9050"
          className="font-mono text-sm"
        />
      </div>
    </div>
  );
}

function ProxyAuthFields({
  nodeConfig,
  onConfigChange,
}: {
  nodeConfig: NodeConfigType;
  onConfigChange: (config: NodeConfigType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Input
        type="text"
        value={nodeConfig.proxyUsername || ''}
        onChange={(event) => onConfigChange({ ...nodeConfig, proxyUsername: event.target.value || undefined })}
        placeholder="Username (optional)"
        className="text-sm"
      />
      <Input
        type="password"
        value={nodeConfig.proxyPassword || ''}
        onChange={(event) => onConfigChange({ ...nodeConfig, proxyPassword: event.target.value || undefined })}
        placeholder="Password (optional)"
        className="text-sm"
      />
    </div>
  );
}

function ProxyPresetButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${proxyPresetButtonClass(active)}`}
    >
      {children}
    </button>
  );
}

function proxyPresetButtonClass(active: boolean): string {
  return active
    ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700'
    : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100';
}

function isProxyPresetActive(nodeConfig: NodeConfigType, port: number): boolean {
  return nodeConfig.proxyHost === '127.0.0.1' && nodeConfig.proxyPort === port;
}
