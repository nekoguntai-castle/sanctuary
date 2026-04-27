import type { SettingsTabProps } from '../types';
import {
  ActionButtons,
  CapabilityControls,
  CredentialControls,
  NextStepHint,
  StatusMessages,
} from './SettingsTabAdditionalControls';
import { EndpointControls, ModelSelectionControls } from './SettingsTabModelControls';
import { ProviderProfileControls } from './SettingsTabProviderControls';

export function SettingsTab(props: SettingsTabProps) {
  return (
    <div className="space-y-6">
      <ProviderProfileControls {...props} />
      <EndpointControls {...props} />
      <ModelSelectionControls {...props} />
      <CapabilityControls
        providerCapabilities={props.providerCapabilities}
        onProviderCapabilityChange={props.onProviderCapabilityChange}
      />
      <CredentialControls {...props} />
      <ActionButtons {...props} />
      <StatusMessages {...props} />
      <NextStepHint
        aiEndpoint={props.aiEndpoint}
        aiModel={props.aiModel}
        onNavigateToModels={props.onNavigateToModels}
      />
    </div>
  );
}
