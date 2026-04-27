import type { OllamaModel, OllamaContainerStatus } from "../../src/api/ai";
import type {
  AdminMcpApiKey,
  AdminMcpServerStatus,
  AdminUser,
  AIProviderCapabilities,
  AIProviderType,
} from "../../src/api/admin";
import type { ModelDownloadProgress } from "../../hooks/websocket";
import type { EditableProviderProfile } from "./providerProfileModel";

export interface PopularModel {
  name: string;
  description: string;
  recommended?: boolean;
}

export type AISettingsTab = "status" | "settings" | "models" | "mcp";

export interface StatusTabProps {
  providerType: AIProviderType;
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
  providerProfiles: EditableProviderProfile[];
  activeProviderProfileId: string;
  providerName: string;
  providerType: AIProviderType;
  providerCapabilities: AIProviderCapabilities;
  credentialStatusText: string;
  credentialApiKey: string;
  clearCredential: boolean;
  aiEndpoint: string;
  aiModel: string;
  isSaving: boolean;
  isDetecting: boolean;
  detectMessage: string;
  showModelDropdown: boolean;
  availableModels: OllamaModel[];
  isLoadingModels: boolean;
  aiStatus: "idle" | "checking" | "connected" | "error";
  aiStatusMessage: string;
  saveSuccess: boolean;
  saveError: string | null;
  onSelectProviderProfile: (profileId: string) => void;
  onAddProviderProfile: () => void;
  onRemoveActiveProviderProfile: () => void;
  onProviderNameChange: (value: string) => void;
  onProviderTypeChange: (value: AIProviderType) => void;
  onProviderCapabilityChange: (
    capability: keyof AIProviderCapabilities,
    value: boolean,
  ) => void;
  onCredentialApiKeyChange: (value: string) => void;
  onClearCredentialChange: (value: boolean) => void;
  onEndpointChange: (value: string) => void;
  onDetectOllama: () => void;
  onModelChange: (value: string) => void;
  onSelectModel: (modelName: string) => void;
  onToggleModelDropdown: () => void;
  onSaveConfig: () => void;
  onTestConnection: () => void;
  onRefreshModels: () => void;
  onNavigateToModels: () => void;
  formatModelSize: (bytes: number) => string;
}

export interface McpKeyFormState {
  userId: string;
  name: string;
  walletIds: string;
  allowAuditLogs: boolean;
  expiresAt: string;
}

export interface McpAccessTabProps {
  status: AdminMcpServerStatus | null;
  keys: AdminMcpApiKey[];
  users: AdminUser[];
  form: McpKeyFormState;
  loading: boolean;
  isCreating: boolean;
  revokingKeyId: string | null;
  createdToken: string | null;
  error: string | null;
  onFormChange: <K extends keyof McpKeyFormState>(
    key: K,
    value: McpKeyFormState[K],
  ) => void;
  onCreateKey: () => void;
  onRevokeKey: (keyId: string) => void;
  onDismissCreatedToken: () => void;
  onRefresh: () => void;
}

export interface ModelsTabProps {
  providerType: AIProviderType;
  aiModel: string;
  pullProgress: string;
  downloadProgress: ModelDownloadProgress | null;
  isPulling: boolean;
  pullModelName: string;
  customModelName: string;
  isLoadingPopularModels: boolean;
  popularModelsError: string | null;
  popularModels: PopularModel[];
  availableModels: OllamaModel[];
  isLoadingModels: boolean;
  isDeleting: boolean;
  deleteModelName: string;
  onSelectModel: (modelName: string) => void;
  onRefreshModels: () => void;
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
  onClose: () => void;
  onEnable: () => void;
}
