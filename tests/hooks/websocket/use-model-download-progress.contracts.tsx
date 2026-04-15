import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectionChangeCallbacks,
  eventCallbacks,
  mockGetState,
  mockIsConnected,
  mockOff,
  mockOn,
  mockOnConnectionChange,
  mockSubscribe,
  mockUnsubscribe,
} from './useWebSocketTestHarness';
import {
  useModelDownloadProgress,
} from '../../../hooks/websocket';

export function registerUseModelDownloadProgressTests(): void {
  describe('useModelDownloadProgress', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      connectionChangeCallbacks.clear();
      eventCallbacks.clear();

      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
        connectionChangeCallbacks.add(callback);
      });

      mockOn.mockImplementation((eventType: string, callback: (event: any) => void) => {
        if (!eventCallbacks.has(eventType)) {
          eventCallbacks.set(eventType, new Set());
        }
        eventCallbacks.get(eventType)!.add(callback);
      });

      mockOff.mockImplementation((eventType: string, callback: (event: any) => void) => {
        const callbacks = eventCallbacks.get(eventType);
        if (callbacks) {
          callbacks.delete(callback);
        }
      });
    });

    it('should subscribe to system channel when connected', () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useModelDownloadProgress());

      expect(mockSubscribe).toHaveBeenCalledWith('system');
    });

    it('should not subscribe when disconnected', () => {
      mockIsConnected.mockReturnValue(false);

      renderHook(() => useModelDownloadProgress());

      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('should unsubscribe from system channel on unmount', () => {
      mockIsConnected.mockReturnValue(true);

      const { unmount } = renderHook(() => useModelDownloadProgress());

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalledWith('system');
    });

    it('should receive modelDownload events and update progress', async () => {
      mockIsConnected.mockReturnValue(true);

      const { result } = renderHook(() => useModelDownloadProgress());

      const progressEvent = {
        event: 'modelDownload',
        data: {
          model: 'llama3.2:1b',
          status: 'downloading' as const,
          completed: 50000000,
          total: 100000000,
          percent: 50,
          digest: 'sha256:abc123',
        },
      };

      act(() => {
        eventCallbacks.get('modelDownload')?.forEach(cb => cb(progressEvent));
      });

      await waitFor(() => {
        expect(result.current.progress).toEqual(progressEvent.data);
      });
    });

    it('should call onProgress callback when provided', async () => {
      mockIsConnected.mockReturnValue(true);

      const onProgress = vi.fn();
      renderHook(() => useModelDownloadProgress(onProgress));

      const progressEvent = {
        event: 'modelDownload',
        data: {
          model: 'llama3.2:3b',
          status: 'pulling' as const,
          completed: 0,
          total: 200000000,
          percent: 0,
        },
      };

      act(() => {
        eventCallbacks.get('modelDownload')?.forEach(cb => cb(progressEvent));
      });

      await waitFor(() => {
        expect(onProgress).toHaveBeenCalledWith(progressEvent.data);
      });
    });

    it('should ignore non-modelDownload events', async () => {
      mockIsConnected.mockReturnValue(true);

      const onProgress = vi.fn();
      const { result } = renderHook(() => useModelDownloadProgress(onProgress));

      const transactionEvent = {
        event: 'transaction',
        data: { txid: 'tx123' },
      };

      act(() => {
        eventCallbacks.get('modelDownload')?.forEach(cb => cb(transactionEvent));
      });

      // Should not update progress or call callback
      expect(result.current.progress).toBeNull();
      expect(onProgress).not.toHaveBeenCalled();
    });

    it('should handle events for different models', async () => {
      mockIsConnected.mockReturnValue(true);

      const { result } = renderHook(() => useModelDownloadProgress());

      const model1Event = {
        event: 'modelDownload',
        data: {
          model: 'llama3.2:1b',
          status: 'downloading' as const,
          completed: 25000000,
          total: 100000000,
          percent: 25,
        },
      };

      const model2Event = {
        event: 'modelDownload',
        data: {
          model: 'llama3.2:3b',
          status: 'complete' as const,
          completed: 200000000,
          total: 200000000,
          percent: 100,
        },
      };

      act(() => {
        eventCallbacks.get('modelDownload')?.forEach(cb => cb(model1Event));
      });

      await waitFor(() => {
        expect(result.current.progress?.model).toBe('llama3.2:1b');
      });

      act(() => {
        eventCallbacks.get('modelDownload')?.forEach(cb => cb(model2Event));
      });

      await waitFor(() => {
        expect(result.current.progress?.model).toBe('llama3.2:3b');
        expect(result.current.progress?.status).toBe('complete');
      });
    });

    it('should handle error status', async () => {
      mockIsConnected.mockReturnValue(true);

      const { result } = renderHook(() => useModelDownloadProgress());

      const errorEvent = {
        event: 'modelDownload',
        data: {
          model: 'invalid-model',
          status: 'error' as const,
          completed: 0,
          total: 0,
          percent: 0,
          error: 'Model not found',
        },
      };

      act(() => {
        eventCallbacks.get('modelDownload')?.forEach(cb => cb(errorEvent));
      });

      await waitFor(() => {
        expect(result.current.progress?.status).toBe('error');
        expect(result.current.progress?.error).toBe('Model not found');
      });
    });

    it('should handle verifying status', async () => {
      mockIsConnected.mockReturnValue(true);

      const { result } = renderHook(() => useModelDownloadProgress());

      const verifyingEvent = {
        event: 'modelDownload',
        data: {
          model: 'llama3.2:1b',
          status: 'verifying' as const,
          completed: 100000000,
          total: 100000000,
          percent: 100,
          digest: 'sha256:xyz789',
        },
      };

      act(() => {
        eventCallbacks.get('modelDownload')?.forEach(cb => cb(verifyingEvent));
      });

      await waitFor(() => {
        expect(result.current.progress?.status).toBe('verifying');
        expect(result.current.progress?.digest).toBe('sha256:xyz789');
      });
    });

    it('should return null progress initially', () => {
      mockIsConnected.mockReturnValue(true);

      const { result } = renderHook(() => useModelDownloadProgress());

      expect(result.current.progress).toBeNull();
    });

    it('should subscribe when connection is established', async () => {
      mockIsConnected.mockReturnValue(false);

      renderHook(() => useModelDownloadProgress());

      expect(mockSubscribe).not.toHaveBeenCalled();

      // Simulate connection
      act(() => {
        mockIsConnected.mockReturnValue(true);
        mockGetState.mockReturnValue('connected');
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalledWith('system');
      });
    });
  });
}
