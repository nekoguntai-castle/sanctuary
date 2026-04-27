import type { SettingsTabProps } from "../types";
import {
  CapabilityControls,
  CredentialControls,
} from "./SettingsTabAdditionalControls";
import { ActionButtons } from "./SettingsTabActionControls";
import {
  EndpointControls,
  ModelSelectionControls,
} from "./SettingsTabModelControls";
import { NextStepHint } from "./SettingsTabNextStepHint";
import { ProviderProfileControls } from "./SettingsTabProviderControls";
import { StatusMessages } from "./SettingsTabStatusMessages";

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
        providerType={props.providerType}
        aiEndpoint={props.aiEndpoint}
        aiModel={props.aiModel}
        onNavigateToModels={props.onNavigateToModels}
      />
    </div>
  );
}
