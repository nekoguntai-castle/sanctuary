import React from 'react';
import {
  CheckCircle,
  XCircle,
  Shield,
  RefreshCw,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ProxyTorSectionProps } from './types';

export const ProxyTorSection: React.FC<ProxyTorSectionProps> = ({
  nodeConfig,
  onConfigChange,
  torContainerStatus,
  isTorContainerLoading,
  torContainerMessage,
  showCustomProxy,
  proxyTestStatus,
  proxyTestMessage,
  onProxyPreset,
  onToggleCustomProxy,
  onTorContainerToggle,
  onRefreshTorStatus,
  onTestProxy,
  expanded,
  onToggle,
  summary,
}) => {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className="w-full p-4 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${nodeConfig.proxyEnabled ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-400'}`}>
            <Shield className="w-4 h-4" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Proxy / Tor</h3>
            <p className="text-xs text-sanctuary-500">{summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); onConfigChange({ ...nodeConfig, proxyEnabled: !nodeConfig.proxyEnabled }); }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${nodeConfig.proxyEnabled ? 'bg-primary-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${nodeConfig.proxyEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <ChevronRight className={`w-5 h-5 text-sanctuary-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {expanded && nodeConfig.proxyEnabled && (
        <div className="px-4 pb-4 space-y-4 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
          {/* Bundled Tor Container - Primary Option */}
          {torContainerStatus?.available && (
            <div className={`p-3 rounded-lg border ${
              nodeConfig.proxyHost === 'tor'
                ? 'border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-900/20'
                : 'border-sanctuary-200 dark:border-sanctuary-700'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Shield className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  <div>
                    <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Bundled Tor</span>
                    <p className="text-xs text-sanctuary-500">
                      {!torContainerStatus.exists ? 'Not installed' : torContainerStatus.running ? 'Running' : 'Stopped'}
                    </p>
                  </div>
                </div>
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
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                      torContainerStatus.running ? 'bg-violet-600' : 'bg-sanctuary-300 dark:bg-sanctuary-700'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
                      torContainerStatus.running ? 'translate-x-5' : 'translate-x-1'
                    }`}>
                      {isTorContainerLoading && <Loader2 className="w-3.5 h-3.5 text-violet-600 animate-spin" />}
                    </span>
                  </button>
                </div>
              </div>
              {torContainerMessage && (
                <p className={`text-xs mt-2 ${
                  torContainerMessage.includes('ready') || torContainerMessage.includes('success')
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : torContainerMessage.includes('bootstrap') || torContainerMessage.includes('10-30s')
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-sanctuary-600 dark:text-sanctuary-400'
                }`}>
                  {torContainerMessage}
                </p>
              )}
              {!torContainerStatus.running && torContainerStatus.exists && !torContainerMessage && (
                <p className="text-xs mt-2 text-sanctuary-500">
                  Starting Tor takes 10-30 seconds to connect to the network.
                </p>
              )}
            </div>
          )}

          {/* Use Custom Proxy Toggle - Only show when bundled Tor is not selected */}
          {!(nodeConfig.proxyHost === 'tor' && torContainerStatus?.running) && (
            <>
              <button
                onClick={onToggleCustomProxy}
                className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
              >
                {showCustomProxy ? 'Hide custom proxy settings' : 'Use custom proxy...'}
              </button>

              {showCustomProxy && (
                <div className="space-y-3 p-3 surface-muted rounded-lg">
                  {/* Quick Presets */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => onProxyPreset('tor')}
                      className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                        nodeConfig.proxyHost === '127.0.0.1' && nodeConfig.proxyPort === 9050
                          ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700'
                          : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100'
                      }`}
                    >
                      Tor Daemon (9050)
                    </button>
                    <button
                      onClick={() => onProxyPreset('tor-browser')}
                      className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                        nodeConfig.proxyHost === '127.0.0.1' && nodeConfig.proxyPort === 9150
                          ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700'
                          : 'surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100'
                      }`}
                    >
                      Tor Browser (9150)
                    </button>
                  </div>

                  {/* Host & Port */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-sanctuary-500 mb-1">Host</label>
                      <Input
                        type="text"
                        value={nodeConfig.proxyHost || ''}
                        onChange={(e) => onConfigChange({ ...nodeConfig, proxyHost: e.target.value })}
                        placeholder="127.0.0.1"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-sanctuary-500 mb-1">Port</label>
                      <Input
                        type="number"
                        value={nodeConfig.proxyPort || ''}
                        onChange={(e) => onConfigChange({ ...nodeConfig, proxyPort: parseInt(e.target.value, 10) || undefined })}
                        placeholder="9050"
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>

                  {/* Optional Authentication */}
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      type="text"
                      value={nodeConfig.proxyUsername || ''}
                      onChange={(e) => onConfigChange({ ...nodeConfig, proxyUsername: e.target.value || undefined })}
                      placeholder="Username (optional)"
                      className="text-sm"
                    />
                    <Input
                      type="password"
                      value={nodeConfig.proxyPassword || ''}
                      onChange={(e) => onConfigChange({ ...nodeConfig, proxyPassword: e.target.value || undefined })}
                      placeholder="Password (optional)"
                      className="text-sm"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Test Button & Result */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onTestProxy}
              isLoading={proxyTestStatus === 'testing'}
              disabled={proxyTestStatus === 'testing' || !nodeConfig.proxyHost || !nodeConfig.proxyPort}
            >
              Verify Connection
            </Button>
            {proxyTestMessage && proxyTestStatus !== 'idle' && (
              <div className={`flex items-center gap-1.5 text-sm ${
                proxyTestStatus === 'success' ? 'text-emerald-600' : proxyTestStatus === 'error' ? 'text-rose-600' : 'text-blue-600'
              }`}>
                {proxyTestStatus === 'success' && <CheckCircle className="w-4 h-4" />}
                {proxyTestStatus === 'error' && <XCircle className="w-4 h-4" />}
                {proxyTestStatus === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{proxyTestMessage}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
