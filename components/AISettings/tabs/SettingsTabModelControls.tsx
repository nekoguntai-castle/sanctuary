import { ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react';
import type { SettingsTabProps } from '../types';

type EndpointControlsProps = Pick<
  SettingsTabProps,
  'aiEndpoint' | 'isDetecting' | 'detectMessage' | 'onEndpointChange' | 'onDetectOllama'
>;

export function EndpointControls({
  aiEndpoint,
  isDetecting,
  detectMessage,
  onEndpointChange,
  onDetectOllama,
}: EndpointControlsProps) {
  return (
    <div>
      <label htmlFor="ai-endpoint-url" className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
        AI Endpoint URL
      </label>
      <div className="flex space-x-2">
        <input
          id="ai-endpoint-url"
          type="text"
          value={aiEndpoint}
          onChange={(e) => onEndpointChange(e.target.value)}
          placeholder="http://host.docker.internal:11434"
          className="flex-1 px-4 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          onClick={onDetectOllama}
          disabled={isDetecting}
          className="px-4 py-2 bg-primary-600 dark:bg-primary-300 hover:bg-primary-700 dark:hover:bg-primary-200 text-white rounded-lg disabled:opacity-50 transition-colors flex items-center space-x-2"
        >
          {isDetecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span>Detect</span>
        </button>
      </div>
      {detectMessage && (
        <p className={`text-xs mt-1 ${detectMessage.includes('Found') || detectMessage.includes('Connected') || detectMessage.includes('saved') ? 'text-emerald-600 dark:text-emerald-400' : 'text-sanctuary-500'}`}>
          {detectMessage}
        </p>
      )}
    </div>
  );
}

type ModelSelectionControlsProps = Pick<
  SettingsTabProps,
  | 'aiEndpoint'
  | 'aiModel'
  | 'showModelDropdown'
  | 'availableModels'
  | 'isLoadingModels'
  | 'onSelectModel'
  | 'onToggleModelDropdown'
  | 'onRefreshModels'
  | 'formatModelSize'
>;

export function ModelSelectionControls({
  aiEndpoint,
  aiModel,
  showModelDropdown,
  availableModels,
  isLoadingModels,
  onSelectModel,
  onToggleModelDropdown,
  onRefreshModels,
  formatModelSize,
}: ModelSelectionControlsProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
        Model
      </label>
      <div className="relative">
        <button
          onClick={onToggleModelDropdown}
          className="w-full px-4 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500 flex items-center justify-between"
        >
          <span className={aiModel ? '' : 'text-sanctuary-400'}>{aiModel || 'Select a model...'}</span>
          <span className="flex items-center space-x-2">
            {renderModelLoadingSpinner(isLoadingModels)}
            <ChevronDown className="w-4 h-4 text-sanctuary-400" />
          </span>
        </button>
        {showModelDropdown && (
          <div className="absolute z-10 w-full mt-1 surface-elevated rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg max-h-60 overflow-y-auto">
            <InstalledModelOptions
              availableModels={availableModels}
              aiModel={aiModel}
              onSelectModel={onSelectModel}
              formatModelSize={formatModelSize}
            />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mt-1">
        <p className="text-xs text-sanctuary-500">Select from installed models</p>
        {aiEndpoint && (
          <button onClick={onRefreshModels} disabled={isLoadingModels} className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center space-x-1">
            <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
  );
}

function renderModelLoadingSpinner(isLoading: boolean) {
  if (!isLoading) return null;
  return <Loader2 className="w-4 h-4 animate-spin text-sanctuary-400" />;
}

type InstalledModelOptionsProps = Pick<
  SettingsTabProps,
  'availableModels' | 'aiModel' | 'onSelectModel' | 'formatModelSize'
>;

function InstalledModelOptions({
  availableModels,
  aiModel,
  onSelectModel,
  formatModelSize,
}: InstalledModelOptionsProps) {
  if (availableModels.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-sm text-sanctuary-500">
        No models installed. Go to Models tab to download one.
      </div>
    );
  }

  return (
    <>
      <div className="px-3 py-2 text-xs font-medium text-sanctuary-500 uppercase border-b border-sanctuary-100 dark:border-sanctuary-800">
        Installed Models
      </div>
      {availableModels.map((model) => (
        <button
          key={model.name}
          onClick={() => onSelectModel(model.name)}
          className={`w-full px-3 py-2 text-left hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors ${
            aiModel === model.name ? 'bg-primary-50 dark:bg-primary-900/20' : ''
          }`}
        >
          <span className="text-sm text-sanctuary-900 dark:text-sanctuary-100">{model.name}</span>
          <span className="text-xs text-sanctuary-400 ml-2">{formatModelSize(model.size)}</span>
        </button>
      ))}
    </>
  );
}
