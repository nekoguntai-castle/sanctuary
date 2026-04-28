import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ModelsTabProps } from "../types";

export function ModelsTab({
  providerType,
  aiModel,
  pullProgress,
  downloadProgress,
  isPulling,
  pullModelName,
  customModelName,
  isLoadingPopularModels,
  popularModelsError,
  popularModels,
  availableModels,
  isLoadingModels,
  isDeleting,
  deleteModelName,
  onSelectModel,
  onRefreshModels,
  onPullModel,
  onDeleteModel,
  onCustomModelNameChange,
  onLoadPopularModels,
  formatBytes,
}: ModelsTabProps) {
  const canManageOllamaModels = providerType === "ollama";

  return (
    <div className="space-y-6">
      {/* Resource Notice */}
      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
        <div className="flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {canManageOllamaModels ? (
              <>
                Ollama models use <strong>2-8 GB disk</strong> and{" "}
                <strong>4-16 GB RAM</strong>. Smaller models (1-3B) work on most
                systems.
              </>
            ) : (
              <>
                OpenAI-compatible providers manage model downloads outside
                Sanctuary. Install or remove models in LM Studio or your
                provider app, then refresh the detected list here.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Pull progress */}
      {(pullProgress || downloadProgress) && (
        <div
          className={`p-3 rounded-lg ${
            pullProgress.includes("Successfully")
              ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
              : pullProgress.includes("Failed") ||
                  pullProgress.includes("Error")
                ? "bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300"
                : "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
          }`}
        >
          {downloadProgress &&
          downloadProgress.status === "downloading" &&
          downloadProgress.total > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm font-medium">
                <span className="flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Downloading {pullModelName}</span>
                </span>
                <span className="tabular-nums">
                  {downloadProgress.percent}%
                </span>
              </div>
              <div className="w-full bg-primary-200/60 dark:bg-sanctuary-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-primary-500 to-primary-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress.percent}%` }}
                />
              </div>
              <div className="text-xs tabular-nums">
                {formatBytes(downloadProgress.completed)} /{" "}
                {formatBytes(downloadProgress.total)}
              </div>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              {isPulling && <Loader2 className="w-4 h-4 animate-spin" />}
              <span className="text-sm">
                {downloadProgress?.status === "pulling"
                  ? "Pulling manifest..."
                  : downloadProgress?.status === "verifying"
                    ? "Verifying..."
                    : pullProgress}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Detected Models */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Detected Provider Models
            </h3>
            <p className="text-xs text-sanctuary-500 mt-0.5">
              {canManageOllamaModels
                ? "Models reported by the active Ollama endpoint."
                : "Models reported by the active OpenAI-compatible endpoint."}
            </p>
          </div>
          <button
            onClick={onRefreshModels}
            disabled={isLoadingModels}
            className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center space-x-1 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3 h-3 ${isLoadingModels ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>

        {isLoadingModels && (
          <div className="flex items-center justify-center py-6 rounded-lg border border-dashed border-sanctuary-200 dark:border-sanctuary-700">
            <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
            <span className="ml-2 text-sm text-sanctuary-500">
              Loading provider models...
            </span>
          </div>
        )}

        {!isLoadingModels && availableModels.length === 0 && (
          <div className="p-4 rounded-lg border border-dashed border-sanctuary-200 dark:border-sanctuary-700">
            <p className="text-sm text-sanctuary-500">
              No models detected yet. Configure the provider endpoint in
              Settings, then use Detect or Refresh.
            </p>
          </div>
        )}

        {!isLoadingModels && availableModels.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {availableModels.map((model) => {
              const isSelected = aiModel === model.name;
              return (
                <div
                  key={model.name}
                  className={`p-3 rounded-lg border ${
                    isSelected
                      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10"
                      : "border-sanctuary-200 dark:border-sanctuary-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="truncate text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                          {model.name}
                        </span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-sanctuary-500 mt-0.5">
                        {model.size > 0
                          ? formatBytes(model.size)
                          : "Reported by provider"}
                      </p>
                    </div>
                    <button
                      onClick={() => onSelectModel(model.name)}
                      disabled={isSelected}
                      className="px-3 py-1 text-xs border border-sanctuary-300 dark:border-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 rounded disabled:opacity-50 transition-colors"
                    >
                      {isSelected ? "Selected" : "Use"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recommended Ollama Models Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Recommended Ollama Models
            </h3>
            {!canManageOllamaModels && (
              <p className="text-xs text-sanctuary-500 mt-0.5">
                These recommendations are for Sanctuary-managed Ollama pulls.
              </p>
            )}
          </div>
          {!isLoadingPopularModels && (
            <button
              onClick={onLoadPopularModels}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center space-x-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          )}
        </div>

        {/* Loading state */}
        {isLoadingPopularModels && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
            <span className="ml-2 text-sm text-sanctuary-500">
              Loading popular models...
            </span>
          </div>
        )}

        {/* Error state */}
        {!isLoadingPopularModels && popularModelsError && (
          <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
            <div className="flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-rose-700 dark:text-rose-300">
                  {popularModelsError}
                </p>
                <button
                  onClick={onLoadPopularModels}
                  className="mt-2 text-xs text-rose-600 dark:text-rose-400 hover:underline flex items-center space-x-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Try again</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Models grid */}
        {!isLoadingPopularModels &&
          !popularModelsError &&
          popularModels.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {popularModels.map((model) => {
                const isInstalled = availableModels.some(
                  (m) => m.name === model.name,
                );
                const isPullingThis = isPulling && pullModelName === model.name;
                return (
                  <div
                    key={model.name}
                    className={`p-3 rounded-lg border ${isInstalled ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10" : "border-sanctuary-200 dark:border-sanctuary-700"}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                            {model.name}
                          </span>
                          {model.recommended && (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-primary-800 dark:bg-primary-100 text-primary-200 dark:text-primary-800 rounded">
                              Recommended
                            </span>
                          )}
                          {isInstalled && (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          )}
                        </div>
                        <p className="text-xs text-sanctuary-500 mt-0.5">
                          {model.description}
                        </p>
                      </div>
                      {canManageOllamaModels && isInstalled ? (
                        <button
                          onClick={() => onDeleteModel(model.name)}
                          disabled={isDeleting}
                          className="px-2 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded disabled:opacity-50 transition-colors flex items-center space-x-1"
                        >
                          {isDeleting && deleteModelName === model.name ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                          <span>Delete</span>
                        </button>
                      ) : canManageOllamaModels ? (
                        <button
                          onClick={() => onPullModel(model.name)}
                          disabled={isPulling}
                          className="px-3 py-1 text-xs bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded disabled:opacity-50 transition-colors flex items-center space-x-1"
                        >
                          {isPullingThis ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          <span>Pull</span>
                        </button>
                      ) : (
                        <span className="px-2 py-1 text-xs text-sanctuary-500 rounded surface-secondary">
                          Ollama only
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Custom Model Input */}
      <div className="pt-4 border-t border-sanctuary-200 dark:border-sanctuary-700">
        {canManageOllamaModels ? (
          <>
            <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              Pull Any Ollama Model
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={customModelName}
                onChange={(e) => onCustomModelNameChange(e.target.value)}
                placeholder="e.g., qwen3:4b, llama3.2:3b"
                className="flex-1 px-3 py-2 text-sm rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 placeholder:text-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={isPulling}
              />
              <button
                onClick={() => {
                  if (customModelName.trim()) {
                    onPullModel(customModelName.trim());
                    onCustomModelNameChange("");
                  }
                }}
                disabled={isPulling || !customModelName.trim()}
                className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-2"
              >
                <Download className="w-4 h-4" />
                <span>Pull</span>
              </button>
            </div>
            <p className="text-xs text-sanctuary-500 mt-1">
              Browse Ollama tags at{" "}
              <a
                href="https://ollama.com/library"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 dark:text-primary-400 hover:underline"
              >
                ollama.com/library
              </a>
            </p>
          </>
        ) : (
          <div className="p-4 rounded-lg surface-secondary">
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              For LM Studio and other OpenAI-compatible providers, manage model
              downloads in the provider app, then use Refresh above or Detect in
              Settings to update Sanctuary's model list.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
