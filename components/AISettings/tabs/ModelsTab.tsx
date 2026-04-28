import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { OllamaModel } from "../../../src/api/ai";
import type { ModelDownloadProgress } from "../../../hooks/websocket";
import type { ModelsTabProps, PopularModel } from "../types";

function pullProgressClass(pullProgress: string) {
  if (pullProgress.includes("Successfully")) {
    return "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300";
  }

  if (pullProgress.includes("Failed") || pullProgress.includes("Error")) {
    return "bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300";
  }

  return "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300";
}

function progressLabel(
  downloadProgress: ModelDownloadProgress | null,
  pullProgress: string,
) {
  if (downloadProgress?.status === "pulling") {
    return "Pulling manifest...";
  }

  if (downloadProgress?.status === "verifying") {
    return "Verifying...";
  }

  return pullProgress;
}

function ResourceNotice({
  canManageOllamaModels,
}: {
  canManageOllamaModels: boolean;
}) {
  return (
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
              Sanctuary. Install or remove models in LM Studio or your provider
              app, then refresh the detected list here.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

interface PullProgressNoticeProps {
  pullProgress: string;
  downloadProgress: ModelDownloadProgress | null;
  isPulling: boolean;
  pullModelName: string;
  formatBytes: (bytes: number) => string;
}

function PullProgressNotice({
  pullProgress,
  downloadProgress,
  isPulling,
  pullModelName,
  formatBytes,
}: PullProgressNoticeProps) {
  if (!pullProgress && !downloadProgress) {
    return null;
  }

  const isDownloading =
    downloadProgress?.status === "downloading" && downloadProgress.total > 0;

  return (
    <div className={`p-3 rounded-lg ${pullProgressClass(pullProgress)}`}>
      {isDownloading && downloadProgress ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Downloading {pullModelName}</span>
            </span>
            <span className="tabular-nums">{downloadProgress.percent}%</span>
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
            {progressLabel(downloadProgress, pullProgress)}
          </span>
        </div>
      )}
    </div>
  );
}

interface DetectedModelsSectionProps {
  canManageOllamaModels: boolean;
  aiModel: string;
  availableModels: OllamaModel[];
  isLoadingModels: boolean;
  onRefreshModels: () => void;
  onSelectModel: (modelName: string) => void;
  formatBytes: (bytes: number) => string;
}

function DetectedModelsSection({
  canManageOllamaModels,
  aiModel,
  availableModels,
  isLoadingModels,
  onRefreshModels,
  onSelectModel,
  formatBytes,
}: DetectedModelsSectionProps) {
  return (
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

      <DetectedModelsContent
        aiModel={aiModel}
        availableModels={availableModels}
        isLoadingModels={isLoadingModels}
        onSelectModel={onSelectModel}
        formatBytes={formatBytes}
      />
    </div>
  );
}

function DetectedModelsContent({
  aiModel,
  availableModels,
  isLoadingModels,
  onSelectModel,
  formatBytes,
}: Omit<
  DetectedModelsSectionProps,
  "canManageOllamaModels" | "onRefreshModels"
>) {
  if (isLoadingModels) {
    return (
      <div className="flex items-center justify-center py-6 rounded-lg border border-dashed border-sanctuary-200 dark:border-sanctuary-700">
        <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
        <span className="ml-2 text-sm text-sanctuary-500">
          Loading provider models...
        </span>
      </div>
    );
  }

  if (availableModels.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-dashed border-sanctuary-200 dark:border-sanctuary-700">
        <p className="text-sm text-sanctuary-500">
          No models detected yet. Configure the provider endpoint in Settings,
          then use Detect or Refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {availableModels.map((model) => (
        <DetectedModelCard
          key={model.name}
          model={model}
          isSelected={aiModel === model.name}
          onSelectModel={onSelectModel}
          formatBytes={formatBytes}
        />
      ))}
    </div>
  );
}

function DetectedModelCard({
  model,
  isSelected,
  onSelectModel,
  formatBytes,
}: {
  model: OllamaModel;
  isSelected: boolean;
  onSelectModel: (modelName: string) => void;
  formatBytes: (bytes: number) => string;
}) {
  return (
    <div
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
            {model.size > 0 ? formatBytes(model.size) : "Reported by provider"}
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
}

interface RecommendedModelsSectionProps {
  canManageOllamaModels: boolean;
  popularModels: PopularModel[];
  availableModels: OllamaModel[];
  isLoadingPopularModels: boolean;
  popularModelsError: string | null;
  isPulling: boolean;
  pullModelName: string;
  isDeleting: boolean;
  deleteModelName: string;
  onLoadPopularModels: () => void;
  onPullModel: (model: string) => void;
  onDeleteModel: (model: string) => void;
}

function RecommendedModelsSection({
  canManageOllamaModels,
  popularModels,
  availableModels,
  isLoadingPopularModels,
  popularModelsError,
  isPulling,
  pullModelName,
  isDeleting,
  deleteModelName,
  onLoadPopularModels,
  onPullModel,
  onDeleteModel,
}: RecommendedModelsSectionProps) {
  return (
    <div>
      <RecommendedModelsHeader
        canManageOllamaModels={canManageOllamaModels}
        isLoadingPopularModels={isLoadingPopularModels}
        onLoadPopularModels={onLoadPopularModels}
      />
      <RecommendedModelsContent
        canManageOllamaModels={canManageOllamaModels}
        popularModels={popularModels}
        availableModels={availableModels}
        isLoadingPopularModels={isLoadingPopularModels}
        popularModelsError={popularModelsError}
        isPulling={isPulling}
        pullModelName={pullModelName}
        isDeleting={isDeleting}
        deleteModelName={deleteModelName}
        onLoadPopularModels={onLoadPopularModels}
        onPullModel={onPullModel}
        onDeleteModel={onDeleteModel}
      />
    </div>
  );
}

function RecommendedModelsHeader({
  canManageOllamaModels,
  isLoadingPopularModels,
  onLoadPopularModels,
}: {
  canManageOllamaModels: boolean;
  isLoadingPopularModels: boolean;
  onLoadPopularModels: () => void;
}) {
  return (
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
  );
}

function RecommendedModelsContent({
  canManageOllamaModels,
  popularModels,
  availableModels,
  isLoadingPopularModels,
  popularModelsError,
  isPulling,
  pullModelName,
  isDeleting,
  deleteModelName,
  onLoadPopularModels,
  onPullModel,
  onDeleteModel,
}: RecommendedModelsSectionProps) {
  if (isLoadingPopularModels) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
        <span className="ml-2 text-sm text-sanctuary-500">
          Loading popular models...
        </span>
      </div>
    );
  }

  if (popularModelsError) {
    return (
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
    );
  }

  if (popularModels.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {popularModels.map((model) => (
        <RecommendedModelCard
          key={model.name}
          model={model}
          isInstalled={availableModels.some((m) => m.name === model.name)}
          canManageOllamaModels={canManageOllamaModels}
          isPulling={isPulling}
          isPullingThis={isPulling && pullModelName === model.name}
          isDeleting={isDeleting}
          isDeletingThis={isDeleting && deleteModelName === model.name}
          onPullModel={onPullModel}
          onDeleteModel={onDeleteModel}
        />
      ))}
    </div>
  );
}

function RecommendedModelCard({
  model,
  isInstalled,
  canManageOllamaModels,
  isPulling,
  isPullingThis,
  isDeleting,
  isDeletingThis,
  onPullModel,
  onDeleteModel,
}: {
  model: PopularModel;
  isInstalled: boolean;
  canManageOllamaModels: boolean;
  isPulling: boolean;
  isPullingThis: boolean;
  isDeleting: boolean;
  isDeletingThis: boolean;
  onPullModel: (model: string) => void;
  onDeleteModel: (model: string) => void;
}) {
  return (
    <div
      className={`p-3 rounded-lg border ${
        isInstalled
          ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10"
          : "border-sanctuary-200 dark:border-sanctuary-700"
      }`}
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
            {isInstalled && <Check className="w-3.5 h-3.5 text-emerald-500" />}
          </div>
          <p className="text-xs text-sanctuary-500 mt-0.5">
            {model.description}
          </p>
        </div>
        <RecommendedModelAction
          modelName={model.name}
          canManageOllamaModels={canManageOllamaModels}
          isInstalled={isInstalled}
          isPulling={isPulling}
          isPullingThis={isPullingThis}
          isDeleting={isDeleting}
          isDeletingThis={isDeletingThis}
          onPullModel={onPullModel}
          onDeleteModel={onDeleteModel}
        />
      </div>
    </div>
  );
}

function RecommendedModelAction({
  modelName,
  canManageOllamaModels,
  isInstalled,
  isPulling,
  isPullingThis,
  isDeleting,
  isDeletingThis,
  onPullModel,
  onDeleteModel,
}: {
  modelName: string;
  canManageOllamaModels: boolean;
  isInstalled: boolean;
  isPulling: boolean;
  isPullingThis: boolean;
  isDeleting: boolean;
  isDeletingThis: boolean;
  onPullModel: (model: string) => void;
  onDeleteModel: (model: string) => void;
}) {
  if (!canManageOllamaModels) {
    return (
      <span className="px-2 py-1 text-xs text-sanctuary-500 rounded surface-secondary">
        Ollama only
      </span>
    );
  }

  if (isInstalled) {
    return (
      <button
        onClick={() => onDeleteModel(modelName)}
        disabled={isDeleting}
        className="px-2 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded disabled:opacity-50 transition-colors flex items-center space-x-1"
      >
        {isDeletingThis ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Trash2 className="w-3 h-3" />
        )}
        <span>Delete</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => onPullModel(modelName)}
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
  );
}

interface CustomModelInputProps {
  canManageOllamaModels: boolean;
  customModelName: string;
  isPulling: boolean;
  onPullModel: (model: string) => void;
  onCustomModelNameChange: (value: string) => void;
}

function CustomModelInput({
  canManageOllamaModels,
  customModelName,
  isPulling,
  onPullModel,
  onCustomModelNameChange,
}: CustomModelInputProps) {
  const trimmedModelName = customModelName.trim();

  function pullCustomModel() {
    onPullModel(trimmedModelName);
    onCustomModelNameChange("");
  }

  return (
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
              onClick={pullCustomModel}
              disabled={isPulling || !trimmedModelName}
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
  );
}

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
      <ResourceNotice canManageOllamaModels={canManageOllamaModels} />
      <PullProgressNotice
        pullProgress={pullProgress}
        downloadProgress={downloadProgress}
        isPulling={isPulling}
        pullModelName={pullModelName}
        formatBytes={formatBytes}
      />
      <DetectedModelsSection
        canManageOllamaModels={canManageOllamaModels}
        aiModel={aiModel}
        availableModels={availableModels}
        isLoadingModels={isLoadingModels}
        onRefreshModels={onRefreshModels}
        onSelectModel={onSelectModel}
        formatBytes={formatBytes}
      />
      <RecommendedModelsSection
        canManageOllamaModels={canManageOllamaModels}
        popularModels={popularModels}
        availableModels={availableModels}
        isLoadingPopularModels={isLoadingPopularModels}
        popularModelsError={popularModelsError}
        isPulling={isPulling}
        pullModelName={pullModelName}
        isDeleting={isDeleting}
        deleteModelName={deleteModelName}
        onLoadPopularModels={onLoadPopularModels}
        onPullModel={onPullModel}
        onDeleteModel={onDeleteModel}
      />
      <CustomModelInput
        canManageOllamaModels={canManageOllamaModels}
        customModelName={customModelName}
        isPulling={isPulling}
        onPullModel={onPullModel}
        onCustomModelNameChange={onCustomModelNameChange}
      />
    </div>
  );
}
