import React from 'react';
import { ProxyTorSectionProps } from './types';
import { BundledTorContainerCard } from './BundledTorContainerCard';
import { CustomProxyControls } from './CustomProxyControls';
import { ProxyTestControls } from './ProxyTestControls';
import { ProxyTorHeader } from './ProxyTorHeader';

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
      <ProxyTorHeader
        nodeConfig={nodeConfig}
        expanded={expanded}
        summary={summary}
        onToggle={onToggle}
        onConfigChange={onConfigChange}
      />

      {expanded && nodeConfig.proxyEnabled && (
        <div className="px-4 pb-4 space-y-4 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
          <BundledTorContainerCard
            nodeConfig={nodeConfig}
            torContainerStatus={torContainerStatus}
            isTorContainerLoading={isTorContainerLoading}
            torContainerMessage={torContainerMessage}
            onProxyPreset={onProxyPreset}
            onTorContainerToggle={onTorContainerToggle}
            onRefreshTorStatus={onRefreshTorStatus}
          />
          <CustomProxyControls
            nodeConfig={nodeConfig}
            torContainerStatus={torContainerStatus}
            showCustomProxy={showCustomProxy}
            onProxyPreset={onProxyPreset}
            onToggleCustomProxy={onToggleCustomProxy}
            onConfigChange={onConfigChange}
          />
          <ProxyTestControls
            nodeConfig={nodeConfig}
            proxyTestStatus={proxyTestStatus}
            proxyTestMessage={proxyTestMessage}
            onTestProxy={onTestProxy}
          />
        </div>
      )}
    </div>
  );
};
