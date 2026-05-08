import type { ModelsTabProps } from "../types";
import { CustomModelInput } from "./CustomModelInput";
import { DetectedModelsSection } from "./DetectedModelsSection";
import { PullProgressNotice, ResourceNotice } from "./modelsTabPullProgress";
import { RecommendedModelsSection } from "./RecommendedModelsSection";

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
