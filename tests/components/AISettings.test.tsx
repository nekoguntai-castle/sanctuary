import { describe } from 'vitest';

import { registerAISettingsTestHarness } from './AISettings/AISettingsTestHarness';
import { registerAISettingsConfigurationContracts } from './AISettings/AISettings.configuration.contracts';
import { registerAISettingsCustomModelPullContracts } from './AISettings/AISettings.custom-model-pull.contracts';
import { registerAISettingsFeatureFlagContracts } from './AISettings/AISettings.feature-flag.contracts';
import { registerAISettingsFeaturesSectionContracts } from './AISettings/AISettings.features-section.contracts';
import { registerAISettingsInitialLoadingContracts } from './AISettings/AISettings.initial-loading.contracts';
import { registerAISettingsModelPullContracts } from './AISettings/AISettings.model-pull.contracts';
import { registerAISettingsModelSelectionContracts } from './AISettings/AISettings.model-selection.contracts';
import { registerAISettingsOllamaDetectionContracts } from './AISettings/AISettings.ollama-detection.contracts';
import { registerAISettingsProviderMcpContracts } from './AISettings/AISettings.provider-mcp.contracts';
import { registerAISettingsSaveConfigurationContracts } from './AISettings/AISettings.save-configuration.contracts';
import { registerAISettingsSecurityNoticeContracts } from './AISettings/AISettings.security-notice.contracts';
import { registerAISettingsTestConnectionContracts } from './AISettings/AISettings.test-connection.contracts';
import { registerAISettingsToggleContracts } from './AISettings/AISettings.toggle.contracts';

describe('AISettings', () => {
  registerAISettingsTestHarness();
  registerAISettingsFeatureFlagContracts();
  registerAISettingsInitialLoadingContracts();
  registerAISettingsToggleContracts();
  registerAISettingsConfigurationContracts();
  registerAISettingsOllamaDetectionContracts();
  registerAISettingsModelSelectionContracts();
  registerAISettingsSaveConfigurationContracts();
  registerAISettingsTestConnectionContracts();
  registerAISettingsModelPullContracts();
  registerAISettingsCustomModelPullContracts();
  registerAISettingsSecurityNoticeContracts();
  registerAISettingsFeaturesSectionContracts();
  registerAISettingsProviderMcpContracts();
});
