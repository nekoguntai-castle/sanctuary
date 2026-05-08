import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { OllamaModel } from "../../../src/api/ai";
import type { PopularModel } from "../types";

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

export function RecommendedModelsSection({
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
