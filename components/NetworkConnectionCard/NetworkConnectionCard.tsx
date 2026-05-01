import React from "react";
import { AlertTriangle } from "lucide-react";
import type { NetworkConnectionCardProps } from "./types";
import { SingletonConfig } from "./SingletonConfig";
import { PoolConfig } from "./PoolConfig";
import { ConnectionModeSelector } from "./NetworkConnectionCard/ConnectionModeSelector";
import { useNetworkConnectionCardController } from "./NetworkConnectionCard/useNetworkConnectionCardController";
import { Toggle } from "../ui/Toggle";

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
      {network !== "mainnet" && (
        <NetworkSyncToggle
          network={network}
          enabled={controller.networkEnabled}
          onToggle={controller.handleEnabledChange}
        />
      )}

      <ConnectionModeSelector
        mode={controller.mode}
        onModeChange={controller.handleModeChange}
      />

      {/* Singleton Config */}
      {controller.mode === "singleton" && (
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
      {controller.mode === "pool" && (
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
          onToggleAdvanced={() =>
            controller.setShowAdvanced(!controller.showAdvanced)
          }
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

function NetworkSyncToggle({
  network,
  enabled,
  onToggle,
}: {
  network: "testnet" | "signet";
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const label = getNetworkLabel(network);

  return (
    <div className="space-y-3">
      <div className="surface-secondary flex items-center justify-between gap-4 rounded-lg border border-sanctuary-200 p-3 dark:border-sanctuary-800">
        <div>
          <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {label} Sync
          </p>
          <p className="text-xs text-sanctuary-500 dark:text-sanctuary-400">
            {enabled
              ? "Wallet sync and address subscriptions are enabled."
            : "Wallet sync and address subscriptions are off."}
          </p>
        </div>
        <NetworkSyncSwitch
          checked={enabled}
          onChange={onToggle}
          network={network}
          label={`${label} Sync`}
        />
      </div>

      {!enabled && (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            {label} wallets will not sync until {label} Sync is turned on and
            settings are saved.
          </p>
        </div>
      )}
    </div>
  );
}

function getNetworkLabel(network: "testnet" | "signet"): string {
  return network === "testnet" ? "Testnet" : "Signet";
}

function NetworkSyncSwitch({
  checked,
  onChange,
  network,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  network: "testnet" | "signet";
  label: string;
}) {
  const activeClass =
    network === "testnet"
      ? "border-testnet-500 bg-testnet-500"
      : "border-signet-500 bg-signet-500";

  return (
    <Toggle
      checked={checked}
      onChange={onChange}
      ariaLabel={label}
      className="flex-shrink-0 border"
      activeClassName={activeClass}
      inactiveClassName="border-sanctuary-600 bg-sanctuary-700 dark:border-sanctuary-700 dark:bg-sanctuary-800"
      thumbClassName="bg-sanctuary-950 shadow-sm ring-1 ring-white/20 dark:bg-sanctuary-950"
    />
  );
}
