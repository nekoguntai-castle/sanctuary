import type { ModelsTabProps } from "../types";
import { DetectedModelsSection } from "./DetectedModelsSection";

export function ModelsTab({
  providerType,
  aiModel,
  availableModels,
  isLoadingModels,
  onModelChange,
  onSelectModel,
  onRefreshModels,
  formatBytes,
}: ModelsTabProps) {
  const isOllama = providerType === "ollama";

  return (
    <div className="space-y-6">
      <ModelEntry
        aiModel={aiModel}
        onModelChange={onModelChange}
      />
      <DetectedModelsSection
        isOllamaProvider={isOllama}
        aiModel={aiModel}
        availableModels={availableModels}
        isLoadingModels={isLoadingModels}
        onRefreshModels={onRefreshModels}
        onSelectModel={onSelectModel}
        formatBytes={formatBytes}
      />
    </div>
  );
}

function ModelEntry({
  aiModel,
  onModelChange,
}: Pick<ModelsTabProps, "aiModel" | "onModelChange">) {
  return (
    <div>
      <label
        htmlFor="ai-model-name-models-tab"
        className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2"
      >
        Selected Model
      </label>
      <input
        id="ai-model-name-models-tab"
        type="text"
        value={aiModel}
        onChange={(event) => onModelChange(event.target.value)}
        placeholder="Enter a provider model identifier..."
        className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 placeholder:text-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}
