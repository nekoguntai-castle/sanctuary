import { Shield } from "lucide-react";
import type { StatusTabProps } from "../types";

export function StatusTab({
  providerType,
  aiEnabled,
  isSaving,
  aiEndpoint,
  aiModel,
  onToggleAI,
  onNavigateToSettings,
}: StatusTabProps) {
  const usesExternalProvider = providerType === "openai-compatible";

  return (
    <div className="space-y-6">
      {/* Security Notice */}
      <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-start space-x-3">
          <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              AI Data Boundary
            </h3>
            <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
              {usesExternalProvider
                ? "Sanctuary's AI proxy is isolated from private keys, signing operations, and the database. Your configured provider may run outside Sanctuary, so use a trusted endpoint; Sanctuary sends sanitized transaction metadata and never sends addresses or transaction IDs."
                : "Sanctuary sends AI requests through a separate proxy/container with no access to private keys, signing operations, or the database. Only sanitized transaction metadata is shared with the configured model. Addresses and transaction IDs are never exposed."}
            </p>
          </div>
        </div>
      </div>

      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg surface-secondary">
        <div className="flex items-start space-x-4">
          <div className="space-y-1">
            <label className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Enable AI Features
            </label>
            <p className="text-sm text-sanctuary-500 max-w-md">
              Use host Ollama, LM Studio, llama.cpp, vLLM, or another trusted
              OpenAI-compatible endpoint managed outside Sanctuary.
            </p>
          </div>
        </div>
        <button
          onClick={onToggleAI}
          disabled={isSaving}
          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
            aiEnabled
              ? "bg-primary-600 dark:bg-sanctuary-500"
              : "bg-sanctuary-300 dark:bg-sanctuary-700"
          } ${isSaving ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span
            className={`inline-block h-6 w-6 transform rounded-full bg-white dark:bg-sanctuary-200 shadow-md ring-1 ring-black/5 dark:ring-white/10 transition-transform ${
              aiEnabled ? "translate-x-7" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Quick Status Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-lg surface-secondary text-center">
          <div
            className={`text-lg font-semibold ${aiEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-sanctuary-400"}`}
          >
            {aiEnabled ? "ON" : "OFF"}
          </div>
          <div className="text-xs text-sanctuary-500">AI Status</div>
        </div>
        <div className="p-3 rounded-lg surface-secondary text-center">
          <div
            className={`text-lg font-semibold ${aiEndpoint ? "text-emerald-600 dark:text-emerald-400" : "text-sanctuary-400"}`}
          >
            {aiEndpoint ? "\u2713" : "\u2014"}
          </div>
          <div className="text-xs text-sanctuary-500">Endpoint</div>
        </div>
        <div className="p-3 rounded-lg surface-secondary text-center">
          <div
            className={`text-lg font-semibold ${aiModel ? "text-emerald-600 dark:text-emerald-400" : "text-sanctuary-400"}`}
          >
            {aiModel ? "\u2713" : "\u2014"}
          </div>
          <div className="text-xs text-sanctuary-500">Model</div>
        </div>
      </div>

      {/* Next Step Hint */}
      {aiEnabled && (
        <div className="p-4 rounded-lg bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700">
          <p className="text-sm text-primary-700 dark:text-primary-700">
            <span className="font-medium">Next:</span> Go to the{" "}
            <button
              onClick={onNavigateToSettings}
              className="underline font-medium"
            >
              Settings
            </button>{" "}
            tab to configure your AI provider endpoint.
          </p>
        </div>
      )}
    </div>
  );
}
