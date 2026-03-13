/**
 * AI Settings Administration Page
 *
 * Manage AI-powered features in an isolated security context.
 * This page configures the separate AI container that handles all AI operations.
 *
 * Logic is split across focused hooks:
 * - useAISettings: settings state, persistence, detection, model list
 * - useModelManagement: pull/delete models, download progress, popular models
 * - useContainerLifecycle: container start/stop, enable/disable toggle, modal
 * - useAIConnectionStatus: connection test status
 */

import React, { useState } from 'react';
import { Brain, Download, Server, Loader2 } from 'lucide-react';
import { useAIConnectionStatus } from './hooks/useAIConnectionStatus';
import { useAISettings } from './hooks/useAISettings';
import { useModelManagement } from './hooks/useModelManagement';
import { useContainerLifecycle } from './hooks/useContainerLifecycle';
import { formatBytes, formatModelSize } from './utils';
import { StatusTab } from './tabs/StatusTab';
import { SettingsTab } from './tabs/SettingsTab';
import { ModelsTab } from './tabs/ModelsTab';
import { EnableModal } from './components/EnableModal';
import type { AISettingsTab } from './types';

export default function AISettings() {
  // Tab state
  const [activeTab, setActiveTab] = useState<AISettingsTab>('status');

  // AI connection status
  const { aiStatus, aiStatusMessage, handleTestConnection } = useAIConnectionStatus();

  // Core settings: enabled, endpoint, model, model list, save/detect
  const settings = useAISettings();

  // Model management: pull, delete, popular models, download progress
  const models = useModelManagement({
    aiEndpoint: settings.aiEndpoint,
    aiEnabled: settings.aiEnabled,
    aiModel: settings.aiModel,
    setAiModel: settings.setAiModel,
    loadModels: settings.loadModels,
  });

  // Container lifecycle: start/stop, toggle AI, enable modal
  const container = useContainerLifecycle({
    aiEnabled: settings.aiEnabled,
    setAiEnabled: settings.setAiEnabled,
    setAiEndpoint: settings.setAiEndpoint,
    setAiModel: settings.setAiModel,
    containerStatus: settings.containerStatus,
    setContainerStatus: settings.setContainerStatus,
    loadModels: settings.loadModels,
  });

  if (settings.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  // Tab configuration - progressive unlocking
  const tabs: { id: AISettingsTab; label: string; icon: React.ReactNode; enabled: boolean; description: string }[] = [
    { id: 'status', label: 'Status', icon: <Brain className="w-4 h-4" />, enabled: true, description: 'Enable AI' },
    { id: 'settings', label: 'Settings', icon: <Server className="w-4 h-4" />, enabled: settings.aiEnabled, description: 'Configure endpoint' },
    { id: 'models', label: 'Models', icon: <Download className="w-4 h-4" />, enabled: settings.aiEnabled && !!settings.aiEndpoint, description: 'Manage models' },
  ];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
            AI Assistant
          </h1>
          <p className="text-sm text-sanctuary-500 mt-1">
            Configure AI-powered transaction labeling and natural language queries
          </p>
        </div>
        <div className="p-3 surface-secondary rounded-xl">
          <Brain className="w-8 h-8 text-primary-600 dark:text-primary-400" />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="flex border-b border-sanctuary-200 dark:border-sanctuary-700">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              onClick={() => tab.enabled && setActiveTab(tab.id)}
              disabled={!tab.enabled}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-primary-600 dark:text-primary-400 bg-primary-50/50 dark:bg-primary-900/20'
                  : tab.enabled
                    ? 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
                    : 'text-sanctuary-400 dark:text-sanctuary-600 cursor-not-allowed'
              }`}
            >
              <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                activeTab === tab.id
                  ? 'bg-primary-600 dark:bg-sanctuary-500 text-white dark:text-sanctuary-100'
                  : tab.enabled
                    ? 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300'
                    : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400 dark:text-sanctuary-600'
              }`}>
                {index + 1}
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 dark:bg-primary-400" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'status' && (
            <StatusTab
              aiEnabled={settings.aiEnabled}
              isSaving={container.isSaving}
              isStartingContainer={container.isStartingContainer}
              containerMessage={container.containerMessage}
              containerStatus={settings.containerStatus}
              aiEndpoint={settings.aiEndpoint}
              aiModel={settings.aiModel}
              onToggleAI={container.handleToggleAI}
              onStartContainer={container.handleStartContainer}
              onStopContainer={container.handleStopContainer}
              onRefreshContainerStatus={container.refreshContainerStatus}
              onNavigateToSettings={() => setActiveTab('settings')}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              aiEndpoint={settings.aiEndpoint}
              aiModel={settings.aiModel}
              isSaving={settings.isSaving}
              isDetecting={settings.isDetecting}
              detectMessage={settings.detectMessage}
              showModelDropdown={settings.showModelDropdown}
              availableModels={settings.availableModels}
              isLoadingModels={settings.isLoadingModels}
              aiStatus={aiStatus}
              aiStatusMessage={aiStatusMessage}
              saveSuccess={settings.saveSuccess}
              saveError={settings.saveError}
              onEndpointChange={settings.setAiEndpoint}
              onDetectOllama={settings.handleDetectOllama}
              onSelectModel={settings.handleSelectModel}
              onToggleModelDropdown={() => settings.setShowModelDropdown(!settings.showModelDropdown)}
              onSaveConfig={settings.handleSaveConfig}
              onTestConnection={handleTestConnection}
              onRefreshModels={settings.loadModels}
              onNavigateToModels={() => setActiveTab('models')}
              formatModelSize={formatModelSize}
            />
          )}

          {activeTab === 'models' && (
            <ModelsTab
              pullProgress={models.pullProgress}
              downloadProgress={models.downloadProgress}
              isPulling={models.isPulling}
              pullModelName={models.pullModelName}
              customModelName={models.customModelName}
              isLoadingPopularModels={models.isLoadingPopularModels}
              popularModelsError={models.popularModelsError}
              popularModels={models.popularModels}
              availableModels={settings.availableModels}
              isDeleting={models.isDeleting}
              deleteModelName={models.deleteModelName}
              onPullModel={models.handlePullModel}
              onDeleteModel={models.handleDeleteModel}
              onCustomModelNameChange={models.setCustomModelName}
              onLoadPopularModels={models.loadPopularModels}
              formatBytes={formatBytes}
            />
          )}
        </div>
      </div>

      {/* AI Features Info - Always visible at bottom */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <h2 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">What AI Can Do</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg surface-secondary">
              <h3 className="text-xs font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-1">Transaction Labeling</h3>
              <p className="text-xs text-sanctuary-500">AI suggests labels based on amount, direction, and your existing patterns.</p>
            </div>
            <div className="p-3 rounded-lg surface-secondary">
              <h3 className="text-xs font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-1">Natural Language Queries</h3>
              <p className="text-xs text-sanctuary-500">Ask "Show my largest receives this month" and get filtered results.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Enable AI Confirmation Modal */}
      <EnableModal
        showEnableModal={container.showEnableModal}
        isLoadingResources={container.isLoadingResources}
        systemResources={container.systemResources}
        acknowledgeInsufficient={container.acknowledgeInsufficient}
        onAcknowledgeChange={container.setAcknowledgeInsufficient}
        onClose={container.handleCloseEnableModal}
        onEnable={() => container.performToggleAI(true)}
      />
    </div>
  );
}
