/**
 * Hook for model management (pull, delete, popular models)
 *
 * Handles downloading/deleting Ollama models, tracking download progress
 * via WebSocket, and fetching the popular models list from remote.
 */

import { useState, useCallback, useEffect } from 'react';
import * as aiApi from '../../../src/api/ai';
import { createLogger } from '../../../utils/logger';
import { extractErrorMessage } from '../../../utils/errorHandler';
import { useModelDownloadProgress, ModelDownloadProgress } from '../../../hooks/websocket';
import type { PopularModel } from '../types';

const log = createLogger('AISettings:useModelManagement');

// URL to fetch popular models list
const POPULAR_MODELS_URL = 'https://raw.githubusercontent.com/nekoguntai-castle/sanctuary/main/config/popular-models.json';

interface UseModelManagementParams {
  aiEndpoint: string;
  aiEnabled: boolean;
  aiModel: string;
  setAiModel: (model: string) => void;
  loadModels: () => Promise<void>;
}

interface UseModelManagementReturn {
  // Pull state
  isPulling: boolean;
  pullProgress: string;
  pullModelName: string;
  customModelName: string;
  setCustomModelName: (value: string) => void;
  downloadProgress: ModelDownloadProgress | null;
  handlePullModel: (model: string) => Promise<void>;

  // Delete state
  isDeleting: boolean;
  deleteModelName: string;
  handleDeleteModel: (model: string) => Promise<void>;

  // Popular models
  popularModels: PopularModel[];
  isLoadingPopularModels: boolean;
  popularModelsError: string | null;
  loadPopularModels: () => Promise<void>;
}

export function useModelManagement({
  aiModel,
  setAiModel,
  loadModels,
}: UseModelManagementParams): UseModelManagementReturn {
  // Popular models state
  const [popularModels, setPopularModels] = useState<PopularModel[]>([]);
  const [isLoadingPopularModels, setIsLoadingPopularModels] = useState(true);
  const [popularModelsError, setPopularModelsError] = useState<string | null>(null);

  // Pull model state
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState('');
  const [pullModelName, setPullModelName] = useState('');
  const [customModelName, setCustomModelName] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<ModelDownloadProgress | null>(null);

  // Delete model state
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteModelName, setDeleteModelName] = useState('');

  // Subscribe to model download progress via WebSocket
  const handleDownloadProgress = useCallback((progress: ModelDownloadProgress) => {
    if (progress.model === pullModelName) {
      setDownloadProgress(progress);

      // Update status message
      if (progress.status === 'complete') {
        setPullProgress(`Successfully pulled ${progress.model}`);
        setIsPulling(false);
        loadModels();
        setAiModel(progress.model);
        setTimeout(() => {
          setPullProgress('');
          setPullModelName('');
          setDownloadProgress(null);
        }, 3000);
      } else if (progress.status === 'error') {
        setPullProgress(`Failed: ${progress.error || 'Unknown error'}`);
        setIsPulling(false);
        setTimeout(() => {
          setPullProgress('');
          setPullModelName('');
          setDownloadProgress(null);
        }, 5000);
      }
    }
  }, [pullModelName, loadModels, setAiModel]);

  useModelDownloadProgress(handleDownloadProgress);

  // Load popular models from remote on mount
  const loadPopularModels = async () => {
    setIsLoadingPopularModels(true);
    setPopularModelsError(null);
    try {
      const response = await fetch(POPULAR_MODELS_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.models && Array.isArray(data.models)) {
        setPopularModels(data.models);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      log.error('Failed to fetch popular models', { error });
      setPopularModelsError('Unable to fetch the latest popular models list. Please check your connection and try again.');
    } finally {
      setIsLoadingPopularModels(false);
    }
  };

  useEffect(() => {
    loadPopularModels();
  }, []);

  const handlePullModel = async (model: string) => {
    setIsPulling(true);
    setPullModelName(model);
    setPullProgress('Starting download...');
    setDownloadProgress(null);

    try {
      const result = await aiApi.pullModel(model);
      if (!result.success) {
        // Immediate failure (before streaming started)
        setPullProgress(`Failed: ${result.error}`);
        setIsPulling(false);
        setTimeout(() => {
          setPullProgress('');
          setPullModelName('');
        }, 5000);
      }
      // If success, progress will come via WebSocket
      // The handleDownloadProgress callback will handle completion
    } catch (error) {
      log.error('Pull model failed', { error });
      setPullProgress(`Error: ${extractErrorMessage(error, 'Pull failed')}`);
      setIsPulling(false);
      setTimeout(() => {
        setPullProgress('');
        setPullModelName('');
      }, 5000);
    }
  };

  const handleDeleteModel = async (model: string) => {
    if (!confirm(`Delete ${model}? This will free up disk space but you'll need to pull it again to use it.`)) {
      return;
    }

    setIsDeleting(true);
    setDeleteModelName(model);

    try {
      const result = await aiApi.deleteModel(model);
      if (result.success) {
        // If we just deleted the currently selected model, clear selection
        if (aiModel === model) {
          setAiModel('');
        }
        // Reload models list
        await loadModels();
      } else {
        alert(`Failed to delete: ${result.error}`);
      }
    } catch (error) {
      log.error('Delete model failed', { error });
      alert(`Error: ${extractErrorMessage(error, 'Delete failed')}`);
    } finally {
      setIsDeleting(false);
      setDeleteModelName('');
    }
  };

  return {
    isPulling,
    pullProgress,
    pullModelName,
    customModelName,
    setCustomModelName,
    downloadProgress,
    handlePullModel,
    isDeleting,
    deleteModelName,
    handleDeleteModel,
    popularModels,
    isLoadingPopularModels,
    popularModelsError,
    loadPopularModels,
  };
}
