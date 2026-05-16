import React, { useState } from "react";
import { ExternalLink, ChevronRight } from "lucide-react";
import { Input } from "../ui/Input";
import { PriceProviderDiagnostics } from "../PriceProviderDiagnostics";
import type { NodeConfig as NodeConfigType } from "../../types";
import {
  DEFAULT_NODE_MEMPOOL_ESTIMATOR,
  NODE_MEMPOOL_ESTIMATOR_VALUES,
  type NodeMempoolEstimator,
  getDefaultNodeExternalServiceUrl,
} from "@sanctuary/shared/constants/nodeConfig";
import type { ExternalServicesSectionProps, NetworkTab } from "./types";

type ExternalServiceUrlField =
  | "explorerUrl"
  | "feeEstimatorUrl"
  | "testnet3ExplorerUrl"
  | "testnet3FeeEstimatorUrl"
  | "testnet4ExplorerUrl"
  | "testnet4FeeEstimatorUrl"
  | "signetExplorerUrl"
  | "signetFeeEstimatorUrl";

interface ExternalServicePreset {
  label: string;
  url: string;
}

interface NetworkExternalServiceConfig {
  label: string;
  explorerField: ExternalServiceUrlField;
  feeField: ExternalServiceUrlField;
  defaultUrl: string;
  presets: ExternalServicePreset[];
}

const NETWORK_TABS: NetworkTab[] = [
  "mainnet",
  "testnet3",
  "testnet4",
  "signet",
];

const NETWORK_EXTERNAL_SERVICES: Record<
  NetworkTab,
  NetworkExternalServiceConfig
> = {
  mainnet: {
    label: "Mainnet",
    explorerField: "explorerUrl",
    feeField: "feeEstimatorUrl",
    defaultUrl: getDefaultNodeExternalServiceUrl("mainnet"),
    presets: [
      { label: "mempool.space", url: getDefaultNodeExternalServiceUrl("mainnet") },
      { label: "blockstream.info", url: "https://blockstream.info" },
    ],
  },
  testnet3: {
    label: "Testnet3",
    explorerField: "testnet3ExplorerUrl",
    feeField: "testnet3FeeEstimatorUrl",
    defaultUrl: getDefaultNodeExternalServiceUrl("testnet3"),
    presets: [
      { label: "mempool.space", url: getDefaultNodeExternalServiceUrl("testnet3") },
      { label: "blockstream.info", url: "https://blockstream.info/testnet" },
    ],
  },
  testnet4: {
    label: "Testnet4",
    explorerField: "testnet4ExplorerUrl",
    feeField: "testnet4FeeEstimatorUrl",
    defaultUrl: getDefaultNodeExternalServiceUrl("testnet4"),
    presets: [
      { label: "mempool.space", url: getDefaultNodeExternalServiceUrl("testnet4") },
    ],
  },
  signet: {
    label: "Signet",
    explorerField: "signetExplorerUrl",
    feeField: "signetFeeEstimatorUrl",
    defaultUrl: getDefaultNodeExternalServiceUrl("signet"),
    presets: [
      { label: "mempool.space", url: getDefaultNodeExternalServiceUrl("signet") },
    ],
  },
};

function getUrlValue(
  nodeConfig: NodeConfigType,
  field: ExternalServiceUrlField,
): string {
  const value = nodeConfig[field];
  return typeof value === "string" ? value : "";
}

function updateUrlField(
  nodeConfig: NodeConfigType,
  field: ExternalServiceUrlField,
  value: string,
): NodeConfigType {
  return { ...nodeConfig, [field]: value };
}

function tabButtonClass(active: boolean): string {
  return active
    ? "bg-primary-600 text-white border-primary-600"
    : "surface-secondary border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700";
}

function presetButtonClass(active: boolean): string {
  return active
    ? "bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300"
    : "surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700";
}

export const ExternalServicesSection: React.FC<
  ExternalServicesSectionProps
> = ({ nodeConfig, onConfigChange, expanded, onToggle, summary }) => {
  const [activeNetwork, setActiveNetwork] = useState<NetworkTab>("mainnet");
  const serviceConfig = NETWORK_EXTERNAL_SERVICES[activeNetwork];
  const explorerUrl = getUrlValue(nodeConfig, serviceConfig.explorerField);
  const feeEstimatorUrl = getUrlValue(nodeConfig, serviceConfig.feeField);

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
            <ExternalLink className="w-4 h-4" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              External Services
            </h3>
            <p className="text-xs text-sanctuary-500">{summary}</p>
          </div>
        </div>
        <ChevronRight
          className={`w-5 h-5 text-sanctuary-400 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-4">
          <div className="flex flex-wrap gap-2">
            {NETWORK_TABS.map((network) => (
              <button
                key={network}
                type="button"
                onClick={() => setActiveNetwork(network)}
                aria-pressed={activeNetwork === network}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${tabButtonClass(activeNetwork === network)}`}
              >
                {NETWORK_EXTERNAL_SERVICES[network].label}
              </button>
            ))}
          </div>

          {/* Block Explorer */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                Block Explorer
              </label>
              <Input
                type="text"
                value={explorerUrl}
                onChange={(e) =>
                  onConfigChange(
                    updateUrlField(
                      nodeConfig,
                      serviceConfig.explorerField,
                      e.target.value,
                    ),
                  )
                }
                placeholder={serviceConfig.defaultUrl}
                aria-label={`${serviceConfig.label} block explorer URL`}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex gap-1 pt-5">
              {serviceConfig.presets.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() =>
                    onConfigChange(
                      updateUrlField(
                        nodeConfig,
                        serviceConfig.explorerField,
                        preset.url,
                      ),
                    )
                  }
                  className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${presetButtonClass(explorerUrl === preset.url)}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Fee Estimation Source - inline radio style */}
          <div>
            <label className="block text-xs font-medium text-sanctuary-500 mb-2">
              Fee Estimation
            </label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={`feeSource-${activeNetwork}`}
                  checked={!!feeEstimatorUrl}
                  onChange={() =>
                    onConfigChange(
                      updateUrlField(
                        nodeConfig,
                        serviceConfig.feeField,
                        serviceConfig.defaultUrl,
                      ),
                    )
                  }
                  className="w-4 h-4 text-primary-600"
                />
                <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
                  Mempool API
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={`feeSource-${activeNetwork}`}
                  checked={!feeEstimatorUrl}
                  onChange={() =>
                    onConfigChange(
                      updateUrlField(nodeConfig, serviceConfig.feeField, ""),
                    )
                  }
                  className="w-4 h-4 text-primary-600"
                />
                <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
                  Electrum Server
                </span>
              </label>
            </div>
          </div>

          {/* Fee Estimator URL - only shown when using Mempool API */}
          {feeEstimatorUrl && (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                  Mempool API URL
                </label>
                <Input
                  type="text"
                  value={feeEstimatorUrl}
                  onChange={(e) =>
                    onConfigChange(
                      updateUrlField(
                        nodeConfig,
                        serviceConfig.feeField,
                        e.target.value,
                      ),
                    )
                  }
                  placeholder={serviceConfig.defaultUrl}
                  aria-label={`${serviceConfig.label} mempool API URL`}
                  className="font-mono text-sm"
                />
              </div>
            </div>
          )}

          {/* Block Confirmation Algorithm - compact dropdown */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                Block Confirmation Algorithm
                <span
                  className="ml-1 text-sanctuary-400"
                  title="Projected Blocks: simulates miner block selection. Simple: uses fee rate buckets."
                >
                  (?)
                </span>
              </label>
              <select
                value={nodeConfig.mempoolEstimator || DEFAULT_NODE_MEMPOOL_ESTIMATOR}
                onChange={(e) =>
                  onConfigChange({
                    ...nodeConfig,
                    mempoolEstimator: e.target.value as NodeMempoolEstimator,
                  })
                }
                className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              >
                <option value={NODE_MEMPOOL_ESTIMATOR_VALUES[0]}>
                  Projected Blocks (Accurate)
                </option>
                <option value={NODE_MEMPOOL_ESTIMATOR_VALUES[1]}>
                  Simple Fee Buckets (Fast)
                </option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
            <PriceProviderDiagnostics />
          </div>
        </div>
      )}
    </div>
  );
};
