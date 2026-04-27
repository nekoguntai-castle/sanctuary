import { Plus, Trash2 } from 'lucide-react';
import type { AIProviderType } from '../../../src/api/admin';
import type { SettingsTabProps } from '../types';

type ProviderProfileControlsProps = Pick<
  SettingsTabProps,
  | 'providerProfiles'
  | 'activeProviderProfileId'
  | 'providerName'
  | 'providerType'
  | 'onSelectProviderProfile'
  | 'onAddProviderProfile'
  | 'onRemoveActiveProviderProfile'
  | 'onProviderNameChange'
  | 'onProviderTypeChange'
>;

export function ProviderProfileControls({
  providerProfiles,
  activeProviderProfileId,
  providerName,
  providerType,
  onSelectProviderProfile,
  onAddProviderProfile,
  onRemoveActiveProviderProfile,
  onProviderNameChange,
  onProviderTypeChange,
}: ProviderProfileControlsProps) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3">
        <div>
          <label htmlFor="ai-provider-profile" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Provider Profile
          </label>
          <select
            id="ai-provider-profile"
            value={activeProviderProfileId}
            onChange={(event) => onSelectProviderProfile(event.target.value)}
            className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {providerProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onAddProviderProfile}
            className="w-full md:w-auto px-4 py-2 border border-sanctuary-300 dark:border-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 rounded-lg transition-colors flex items-center justify-center space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add</span>
          </button>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onRemoveActiveProviderProfile}
            disabled={providerProfiles.length <= 1}
            className="w-full md:w-auto px-4 py-2 border border-sanctuary-300 dark:border-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center space-x-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>Remove</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="ai-provider-name" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Profile Name
          </label>
          <input
            id="ai-provider-name"
            type="text"
            value={providerName}
            onChange={(event) => onProviderNameChange(event.target.value)}
            className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label htmlFor="ai-provider-type" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Provider Type
          </label>
          <select
            id="ai-provider-type"
            value={providerType}
            onChange={(event) => onProviderTypeChange(event.target.value as AIProviderType)}
            className="w-full px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="ollama">Ollama</option>
            <option value="openai-compatible">OpenAI-compatible</option>
          </select>
        </div>
      </div>
    </>
  );
}
