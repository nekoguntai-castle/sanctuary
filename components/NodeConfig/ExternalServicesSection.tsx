import React from "react";
import { ExternalLink, ChevronRight } from "lucide-react";
import { Input } from "../ui/Input";
import { PriceProviderDiagnostics } from "../PriceProviderDiagnostics";
import { ExternalServicesSectionProps } from "./types";

export const ExternalServicesSection: React.FC<
  ExternalServicesSectionProps
> = ({ nodeConfig, onConfigChange, expanded, onToggle, summary }) => {
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
          {/* Block Explorer */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                Block Explorer
              </label>
              <Input
                type="text"
                value={nodeConfig.explorerUrl || ""}
                onChange={(e) =>
                  onConfigChange({ ...nodeConfig, explorerUrl: e.target.value })
                }
                placeholder="https://mempool.space"
                className="font-mono text-sm"
              />
            </div>
            <div className="flex gap-1 pt-5">
              {["mempool.space", "blockstream.info"].map((preset) => (
                <button
                  key={preset}
                  onClick={() =>
                    onConfigChange({
                      ...nodeConfig,
                      explorerUrl: `https://${preset}`,
                    })
                  }
                  className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                    nodeConfig.explorerUrl === `https://${preset}`
                      ? "bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300"
                      : "surface-secondary border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700"
                  }`}
                >
                  {preset}
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
                  name="feeSource"
                  checked={!!nodeConfig.feeEstimatorUrl}
                  onChange={() =>
                    onConfigChange({
                      ...nodeConfig,
                      feeEstimatorUrl: "https://mempool.space",
                    })
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
                  name="feeSource"
                  checked={!nodeConfig.feeEstimatorUrl}
                  onChange={() =>
                    onConfigChange({ ...nodeConfig, feeEstimatorUrl: "" })
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
          {nodeConfig.feeEstimatorUrl && (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-sanctuary-500 mb-1">
                  Mempool API URL
                </label>
                <Input
                  type="text"
                  value={nodeConfig.feeEstimatorUrl}
                  onChange={(e) =>
                    onConfigChange({
                      ...nodeConfig,
                      feeEstimatorUrl: e.target.value,
                    })
                  }
                  placeholder="https://mempool.space"
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
                value={nodeConfig.mempoolEstimator || "mempool_space"}
                onChange={(e) =>
                  onConfigChange({
                    ...nodeConfig,
                    mempoolEstimator: e.target.value as
                      | "simple"
                      | "mempool_space",
                  })
                }
                className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              >
                <option value="mempool_space">
                  Projected Blocks (Accurate)
                </option>
                <option value="simple">Simple Fee Buckets (Fast)</option>
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
