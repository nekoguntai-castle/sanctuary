import type { OllamaModel, OllamaContainerStatus, SystemResources } from '../../src/api/ai';
import type { ModelDownloadProgress } from '../../hooks/websocket';

export interface PopularModel {
  name: string;
  description: string;
  recommended?: boolean;
}

export type AISettingsTab = 'status' | 'settings' | 'models';

export interface StatusTabProps {
  aiEnabled: boolean;
  isSaving: boolean;
  isStartingContainer: boolean;
  containerMessage: string;
  containerStatus: OllamaContainerStatus | null;
  aiEndpoint: string;
  aiModel: string;
  onToggleAI: () => void;
  onStartContainer: () => void;
  onStopContainer: () => void;
  onRefreshContainerStatus: () => void;
  onNavigateToSettings: () => void;
}

export interface SettingsTabProps {
  aiEndpoint: string;
  aiModel: string;
  isSaving: boolean;
  isDetecting: boolean;
  detectMessage: string;
  showModelDropdown: boolean;
  availableModels: OllamaModel[];
  isLoadingModels: boolean;
  aiStatus: 'idle' | 'checking' | 'connected' | 'error';
  aiStatusMessage: string;
  saveSuccess: boolean;
  saveError: string | null;
  onEndpointChange: (value: string) => void;
  onDetectOllama: () => void;
  onSelectModel: (modelName: string) => void;
  onToggleModelDropdown: () => void;
  onSaveConfig: () => void;
  onTestConnection: () => void;
  onRefreshModels: () => void;
  onNavigateToModels: () => void;
  formatModelSize: (bytes: number) => string;
}

export interface ModelsTabProps {
  pullProgress: string;
  downloadProgress: ModelDownloadProgress | null;
  isPulling: boolean;
  pullModelName: string;
  customModelName: string;
  isLoadingPopularModels: boolean;
  popularModelsError: string | null;
  popularModels: PopularModel[];
  availableModels: OllamaModel[];
  isDeleting: boolean;
  deleteModelName: string;
  onPullModel: (model: string) => void;
  onDeleteModel: (model: string) => void;
  onCustomModelNameChange: (value: string) => void;
  onLoadPopularModels: () => void;
  formatBytes: (bytes: number) => string;
}

export interface ContainerControlsProps {
  containerStatus: OllamaContainerStatus;
  isStartingContainer: boolean;
  onStartContainer: () => void;
  onStopContainer: () => void;
  onRefreshContainerStatus: () => void;
}

export interface EnableModalProps {
  showEnableModal: boolean;
  isLoadingResources: boolean;
  systemResources: SystemResources | null;
  acknowledgeInsufficient: boolean;
  onAcknowledgeChange: (checked: boolean) => void;
  onClose: () => void;
  onEnable: () => void;
}
