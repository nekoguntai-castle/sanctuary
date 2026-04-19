import React from 'react';
import type { NetworkConnectionCardProps } from './types';
import { SingletonConfig } from './SingletonConfig';
import { PoolConfig } from './PoolConfig';
import { ConnectionModeSelector } from './NetworkConnectionCard/ConnectionModeSelector';
import { useNetworkConnectionCardController } from './NetworkConnectionCard/useNetworkConnectionCardController';

export const NetworkConnectionCard: React.FC<NetworkConnectionCardProps> = ({
  network,
  config,
  servers,
  poolStats,
  onConfigChange,
  onServersChange,
  onTestConnection,
}) => {
  const controller = useNetworkConnectionCardController({
    network,
    config,
    servers,
    poolStats,
    onConfigChange,
    onServersChange,
    onTestConnection,
  });

  return (
      <div className="space-y-6">
        <ConnectionModeSelector mode={controller.mode} onModeChange={controller.handleModeChange} />

        {/* Singleton Config */}
        {controller.mode === 'singleton' && (
          <SingletonConfig
            singletonHost={controller.singletonHost}
            singletonPort={controller.singletonPort}
            singletonSsl={controller.singletonSsl}
            colors={controller.colors}
            presets={controller.presets}
            testStatus={controller.testStatus}
            testMessage={controller.testMessage}
            onUpdateConfig={controller.updateNetworkConfig}
            onTestSingleton={controller.handleTestSingleton}
          />
        )}

        {/* Pool Config */}
        {controller.mode === 'pool' && (
          <PoolConfig
            servers={servers}
            poolStats={poolStats}
            colors={controller.colors}
            presets={controller.presets}
            showAdvanced={controller.showAdvanced}
            isAddingServer={controller.isAddingServer}
            editingServerId={controller.editingServerId}
            newServer={controller.newServer}
            serverActionLoading={controller.serverActionLoading}
            serverTestStatus={controller.serverTestStatus}
            poolMin={controller.poolMin}
            poolMax={controller.poolMax}
            poolLoadBalancing={controller.poolLoadBalancing}
            onToggleAdvanced={() => controller.setShowAdvanced(!controller.showAdvanced)}
            onUpdateConfig={controller.updateNetworkConfig}
            onSetIsAddingServer={controller.setIsAddingServer}
            onSetEditingServerId={controller.setEditingServerId}
            onSetNewServer={controller.setNewServer}
            onTestServer={controller.handleTestServer}
            onToggleServer={controller.handleToggleServer}
            onMoveServer={controller.handleMoveServer}
            onEditServer={controller.handleEditServer}
            onDeleteServer={controller.handleDeleteServer}
            onAddPreset={controller.handleAddPreset}
            onAddServer={controller.handleAddServer}
            onUpdateServer={controller.handleUpdateServer}
            onCancelEdit={controller.handleCancelEdit}
            getDefaultPort={controller.getDefaultPort}
            getServerPoolStats={controller.getServerPoolStats}
          />
        )}
      </div>
  );
};
