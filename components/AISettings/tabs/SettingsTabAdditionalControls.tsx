import { AlertCircle, Check, KeyRound, Loader2 } from 'lucide-react';
import type { AIProviderCapabilities } from '../../../src/api/admin';
import type { SettingsTabProps } from '../types';

type CapabilityControlsProps = {
  providerCapabilities: AIProviderCapabilities;
  onProviderCapabilityChange: SettingsTabProps['onProviderCapabilityChange'];
};

export function CapabilityControls({
  providerCapabilities,
  onProviderCapabilityChange,
}: CapabilityControlsProps) {
  const capabilities: Array<[keyof AIProviderCapabilities, string]> = [
    ['chat', 'Chat'],
    ['toolCalls', 'Tool calls'],
    ['strictJson', 'Strict JSON'],
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
              onChange={(event) => onProviderCapabilityChange(capability, event.target.checked)}
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
  | 'credentialStatusText'
  | 'credentialApiKey'
  | 'clearCredential'
  | 'onCredentialApiKeyChange'
  | 'onClearCredentialChange'
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
        <label htmlFor="ai-provider-credential" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
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
        placeholder="API key"
        className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
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

type ActionButtonsProps = Pick<
  SettingsTabProps,
  'isSaving' | 'aiEndpoint' | 'aiModel' | 'aiStatus' | 'onSaveConfig' | 'onTestConnection'
>;

export function ActionButtons({
  isSaving,
  aiEndpoint,
  aiModel,
  aiStatus,
  onSaveConfig,
  onTestConnection,
}: ActionButtonsProps) {
  return (
    <div className="flex items-center space-x-3">
      <button
        onClick={onSaveConfig}
        disabled={isSaving || !aiEndpoint || !aiModel}
        className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded-lg disabled:opacity-50 transition-colors"
      >
        {isSaving ? 'Saving...' : 'Save Configuration'}
      </button>
      <button
        onClick={onTestConnection}
        disabled={aiStatus === 'checking' || !aiEndpoint || !aiModel}
        className="px-4 py-2 border border-sanctuary-300 dark:border-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 rounded-lg disabled:opacity-50 transition-colors"
      >
        {aiStatus === 'checking' ? 'Testing...' : 'Test Connection'}
      </button>
    </div>
  );
}

type StatusMessagesProps = Pick<
  SettingsTabProps,
  'saveSuccess' | 'saveError' | 'aiStatus' | 'aiStatusMessage'
>;

export function StatusMessages({
  saveSuccess,
  saveError,
  aiStatus,
  aiStatusMessage,
}: StatusMessagesProps) {
  return (
    <>
      {saveSuccess && (
        <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
          <Check className="w-4 h-4" />
          <span className="text-sm">Configuration saved</span>
        </div>
      )}
      {saveError && (
        <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{saveError}</span>
        </div>
      )}
      {aiStatusMessage && (
        <ConnectionStatusMessage aiStatus={aiStatus} aiStatusMessage={aiStatusMessage} />
      )}
    </>
  );
}

type ConnectionStatusMessageProps = Pick<SettingsTabProps, 'aiStatus' | 'aiStatusMessage'>;

function ConnectionStatusMessage({ aiStatus, aiStatusMessage }: ConnectionStatusMessageProps) {
  const statusClass = aiStatus === 'connected'
    ? 'text-emerald-600 dark:text-emerald-400'
    : aiStatus === 'error'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-sanctuary-500';

  return (
    <div className={`flex items-center space-x-2 ${statusClass}`}>
      {aiStatus === 'connected' && <Check className="w-4 h-4" />}
      {aiStatus === 'error' && <AlertCircle className="w-4 h-4" />}
      {aiStatus === 'checking' && <Loader2 className="w-4 h-4 animate-spin" />}
      <span className="text-sm">{aiStatusMessage}</span>
    </div>
  );
}

export function NextStepHint({
  aiEndpoint,
  aiModel,
  onNavigateToModels,
}: Pick<SettingsTabProps, 'aiEndpoint' | 'aiModel' | 'onNavigateToModels'>) {
  if (!aiEndpoint || aiModel) return null;

  return (
    <div className="p-4 rounded-lg bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700">
      <p className="text-sm text-primary-700 dark:text-primary-700">
        <span className="font-medium">Next:</span> Go to the <button onClick={onNavigateToModels} className="underline font-medium">Models</button> tab to download a model.
      </p>
    </div>
  );
}
