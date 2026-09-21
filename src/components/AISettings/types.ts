import type { ProviderModel } from "../../api/ai";
import type {
  AdminMcpApiKey,
  AdminMcpServerStatus,
  AdminUser,
  AIProviderCapabilities,
  AIProviderType,
} from "../../api/admin";
import type { EditableProviderProfile } from "./providerProfileModel";

export type AISettingsTab = "status" | "settings" | "models" | "mcp";

export interface AISettingsController {
  featureUnavailable: boolean;
  providerProfiles: EditableProviderProfile[];
  activeProviderProfileId: string;
  providerName: string;
  setProviderName: (value: string) => void;
  providerType: AIProviderType;
  setProviderType: (value: AIProviderType) => void;
  providerCapabilities: AIProviderCapabilities;
  credentialApiKey: string;
  setCredentialApiKey: (value: string) => void;
  clearCredential: boolean;
  setClearCredential: (value: boolean) => void;
  aiEnabled: boolean;
  setAiEnabled: (value: boolean) => void;
  aiEndpoint: string;
  setAiEndpoint: (value: string) => void;
  aiModel: string;
  setAiModel: (value: string) => void;
  loading: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  isDetecting: boolean;
  detectMessage: string;
  handleSaveConfig: () => Promise<void>;
  handleDetectOllama: () => Promise<void>;
  loadModels: () => Promise<void>;
  handleSelectProviderProfile: (profileId: string) => void;
  handleAddProviderProfile: () => void;
  handleRemoveActiveProviderProfile: () => void;
  handleProviderCapabilityChange: (
    capability: keyof AIProviderCapabilities,
    value: boolean,
  ) => void;
  availableModels: ProviderModel[];
  isLoadingModels: boolean;
  configuredModelRefreshAvailable: boolean;
  configuredModelRefreshUnavailableReason: string | null;
  showModelDropdown: boolean;
  setShowModelDropdown: (value: boolean) => void;
  handleSelectModel: (modelName: string) => void;
}

export interface StatusTabProps {
  providerType: AIProviderType;
  aiEnabled: boolean;
  isSaving: boolean;
  saveError: string | null;
  aiEndpoint: string;
  aiModel: string;
  onToggleAI: () => void;
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
  availableModels: ProviderModel[];
  isLoadingModels: boolean;
  configuredModelRefreshAvailable: boolean;
  configuredModelRefreshUnavailableReason: string | null;
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
  availableModels: ProviderModel[];
  isLoadingModels: boolean;
  configuredModelRefreshAvailable: boolean;
  configuredModelRefreshUnavailableReason: string | null;
  onModelChange: (value: string) => void;
  onSelectModel: (modelName: string) => void;
  onRefreshModels: () => void;
  formatBytes: (bytes: number) => string;
}

export interface EnableModalProps {
  showEnableModal: boolean;
  onClose: () => void;
  onEnable: () => void;
}
