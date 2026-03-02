/**
 * Model Download Progress Hook
 *
 * Subscribe to model download progress events via WebSocket.
 * Used in AISettings to show real-time progress during model pulls.
 */

import { useEffect, useState } from 'react';
import { websocketClient, WebSocketEvent } from '../../services/websocket';
import { useWebSocket } from './useWebSocket';

export interface ModelDownloadProgress {
  model: string;
  status: 'pulling' | 'downloading' | 'verifying' | 'complete' | 'error';
  completed: number;
  total: number;
  percent: number;
  digest?: string;
  error?: string;
}

export const useModelDownloadProgress = (
  onProgress?: (progress: ModelDownloadProgress) => void
): { progress: ModelDownloadProgress | null } => {
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);

  // Use the main useWebSocket hook to ensure connection is established
  const { connected } = useWebSocket();

  useEffect(() => {
    // Only subscribe when connected
    if (!connected) {
      return;
    }

    // Subscribe to system channel to receive model download events
    websocketClient.subscribe('system');

    const handleProgress = (event: WebSocketEvent) => {
      // Events come with type='event' and event='modelDownload'
      if (event.event !== 'modelDownload') return;

      const data = event.data as ModelDownloadProgress;
      setProgress(data);
      onProgress?.(data);
    };

    websocketClient.on('modelDownload', handleProgress);

    return () => {
      websocketClient.off('modelDownload', handleProgress);
      websocketClient.unsubscribe('system');
    };
  }, [connected, onProgress]);

  return { progress };
};
