import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { ExternalServicesSection } from './ExternalServicesSection';
import { NetworkConnectionsSection } from './NetworkConnectionsSection';
import { ProxyTorSection } from './ProxyTorSection';
import { SectionId, NetworkTab } from './types';
import { NodeConfigStatusMessages } from './NodeConfigStatusMessages';
import {
  getExternalServicesSummary,
  getNetworksSummary,
  getProxySummary,
} from './nodeConfigData';
import { useElectrumServerControls } from './useElectrumServerControls';
import { useNodeConfigData } from './useNodeConfigData';
import { useNodeConfigSave } from './useNodeConfigSave';
import { useProxyTorControls } from './useProxyTorControls';

export const NodeConfig: React.FC = () => {
  const [expandedSection, setExpandedSection] = useState<SectionId | null>(null);
  const [activeNetworkTab, setActiveNetworkTab] = useState<NetworkTab>('mainnet');
  const configData = useNodeConfigData();
  const saveState = useNodeConfigSave(configData.nodeConfig);
  const electrumControls = useElectrumServerControls({
    allServers: configData.allServers,
    setAllServers: configData.setAllServers,
  });
  const proxyControls = useProxyTorControls({
    nodeConfig: configData.nodeConfig,
    setNodeConfig: configData.setNodeConfig,
    torContainerStatus: configData.torContainerStatus,
    setTorContainerStatus: configData.setTorContainerStatus,
    showCustomProxy: configData.showCustomProxy,
    setShowCustomProxy: configData.setShowCustomProxy,
  });

  const toggleSection = (section: SectionId) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  if (configData.loading) return <div className="p-8 text-center text-sanctuary-400">Loading node configuration...</div>;

  return (
    <div className="space-y-4 animate-fade-in pb-12">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Node Configuration</h2>
          <p className="text-sm text-sanctuary-500">Configure network settings for the Bitcoin backend</p>
        </div>
        <Button onClick={saveState.handleSaveNodeConfig} isLoading={saveState.isSavingNode}>
          Save All Settings
        </Button>
      </div>

      {configData.nodeConfig && (
        <NodeConfigStatusMessages
          error={saveState.nodeSaveError}
          success={saveState.nodeSaveSuccess}
        />
      )}

      {configData.nodeConfig && (
        <div className="space-y-3">
          <ExternalServicesSection
            nodeConfig={configData.nodeConfig}
            onConfigChange={configData.setNodeConfig}
            expanded={expandedSection === 'external'}
            onToggle={() => toggleSection('external')}
            summary={getExternalServicesSummary(configData.nodeConfig)}
          />

          <NetworkConnectionsSection
            nodeConfig={configData.nodeConfig}
            servers={configData.allServers}
            poolStats={configData.poolStats}
            activeNetworkTab={activeNetworkTab}
            onNetworkTabChange={setActiveNetworkTab}
            onConfigChange={configData.setNodeConfig}
            onServersChange={electrumControls.handleServersChange}
            onTestConnection={electrumControls.handleTestConnection}
            expanded={expandedSection === 'networks'}
            onToggle={() => toggleSection('networks')}
            summary={getNetworksSummary(configData.nodeConfig, configData.allServers)}
          />

          <ProxyTorSection
            nodeConfig={configData.nodeConfig}
            onConfigChange={configData.setNodeConfig}
            torContainerStatus={configData.torContainerStatus}
            isTorContainerLoading={proxyControls.isTorContainerLoading}
            torContainerMessage={proxyControls.torContainerMessage}
            showCustomProxy={configData.showCustomProxy}
            proxyTestStatus={proxyControls.proxyTestStatus}
            proxyTestMessage={proxyControls.proxyTestMessage}
            onProxyPreset={proxyControls.handleProxyPreset}
            onToggleCustomProxy={proxyControls.toggleCustomProxy}
            onTorContainerToggle={proxyControls.handleTorContainerToggle}
            onRefreshTorStatus={proxyControls.refreshTorContainerStatus}
            onTestProxy={proxyControls.handleTestProxy}
            expanded={expandedSection === 'proxy'}
            onToggle={() => toggleSection('proxy')}
            summary={getProxySummary(configData.nodeConfig)}
          />
        </div>
      )}
    </div>
  );
};
