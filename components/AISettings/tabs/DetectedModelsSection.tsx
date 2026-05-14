import { Check, Loader2, RefreshCw } from "lucide-react";
import type { OllamaModel } from "../../../src/api/ai";

interface DetectedModelsSectionProps {
  isOllamaProvider: boolean;
  aiModel: string;
  availableModels: OllamaModel[];
  isLoadingModels: boolean;
  onRefreshModels: () => void;
  onSelectModel: (modelName: string) => void;
  formatBytes: (bytes: number) => string;
}

export function DetectedModelsSection({
  isOllamaProvider,
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
            {isOllamaProvider
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
  "isOllamaProvider" | "onRefreshModels"
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
