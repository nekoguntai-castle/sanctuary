import { KeyRound } from "lucide-react";
import type { AIProviderCapabilities } from "../../../src/api/admin";
import type { SettingsTabProps } from "../types";

type CapabilityControlsProps = {
  providerCapabilities: AIProviderCapabilities;
  onProviderCapabilityChange: SettingsTabProps["onProviderCapabilityChange"];
};

export function CapabilityControls({
  providerCapabilities,
  onProviderCapabilityChange,
}: CapabilityControlsProps) {
  const capabilities: Array<[keyof AIProviderCapabilities, string]> = [
    ["chat", "Chat"],
    ["toolCalls", "Tool calls"],
    ["strictJson", "Strict JSON"],
  ];

  return (
    <fieldset>
      <legend className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
        Model Capabilities
      </legend>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {capabilities.map(([capability, label]) => (
          <label
            key={capability}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg surface-secondary text-sm text-sanctuary-700 dark:text-sanctuary-300"
          >
            <span>{label}</span>
            <input
              type="checkbox"
              checked={providerCapabilities[capability]}
              onChange={(event) =>
                onProviderCapabilityChange(capability, event.target.checked)
              }
              className="h-4 w-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type CredentialControlsProps = Pick<
  SettingsTabProps,
  | "credentialStatusText"
  | "credentialApiKey"
  | "clearCredential"
  | "onCredentialApiKeyChange"
  | "onClearCredentialChange"
>;

export function CredentialControls({
  credentialStatusText,
  credentialApiKey,
  clearCredential,
  onCredentialApiKeyChange,
  onClearCredentialChange,
}: CredentialControlsProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label
          htmlFor="ai-provider-credential"
          className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100"
        >
          Provider Credential
        </label>
        <span className="inline-flex items-center gap-1 text-xs text-sanctuary-500">
          <KeyRound className="w-3 h-3" />
          {credentialStatusText}
        </span>
      </div>
      <input
        id="ai-provider-credential"
        type="password"
        value={credentialApiKey}
        onChange={(event) => onCredentialApiKeyChange(event.target.value)}
        placeholder="Optional API key"
        className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <p className="mt-1 text-xs text-sanctuary-500">
        Leave blank for local providers that do not require authentication.
      </p>
      <label className="mt-2 flex items-center gap-2 text-xs text-sanctuary-600 dark:text-sanctuary-400">
        <input
          type="checkbox"
          checked={clearCredential}
          onChange={(event) => onClearCredentialChange(event.target.checked)}
          className="h-4 w-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
        />
        <span>Clear stored credential on save</span>
      </label>
    </div>
  );
}
