/**
 * Device Save Hook
 *
 * Manages state for saving devices and handling conflicts:
 * - Creating new devices
 * - Detecting conflicts with existing devices
 * - Merging accounts into existing devices
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createDeviceWithConflictHandling,
  mergeDeviceAccounts,
  CreateDeviceRequest,
  DeviceConflictResponse,
} from '../api/devices';
import { useLatestRequest } from './useLatestRequest';
import type { FetchToken } from './requestOwnership';
import { useSidebar } from '../contexts/SidebarContext';
import { createLogger } from '../utils/logger';
import { useInvalidateDevices } from './queries/useInvalidateDevices';

const log = createLogger('useDeviceSave');

export interface UseDeviceSaveState {
  /** Whether a save operation is in progress */
  saving: boolean;
  /** Whether a merge operation is in progress */
  merging: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Conflict data if device already exists */
  conflictData: DeviceConflictResponse | null;
  /** Save a new device, handling conflicts */
  saveDevice: (request: CreateDeviceRequest) => Promise<void>;
  /** Merge accounts into existing device after conflict */
  mergeDevice: (request: CreateDeviceRequest) => Promise<void>;
  /** Clear conflict state */
  clearConflict: () => void;
  /** Clear error state */
  clearError: () => void;
  /** Reset all state */
  reset: () => void;
}

/**
 * Hook for managing device save operations
 *
 * @example
 * const { saving, error, conflictData, saveDevice, mergeDevice, clearConflict } = useDeviceSave();
 *
 * const handleSave = async () => {
 *   await saveDevice({
 *     type: model.name,
 *     label: 'My Device',
 *     fingerprint: '12345678',
 *     accounts: [...],
 *     modelSlug: model.slug,
 *   });
 * };
 */
export function useDeviceSave(options: { onSuccess?: (deviceId: string) => void } = {}): UseDeviceSaveState {
  const navigate = useNavigate();
  const { refreshSidebar } = useSidebar();
  const invalidateDevices = useInvalidateDevices();
  const onSuccess = options.onSuccess;

  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictData, setConflictData] = useState<DeviceConflictResponse | null>(null);

  const operations = useLatestRequest();
  const retireOperation = useCallback(() => {
    operations.invalidate();
    setSaving(false);
    setMerging(false);
  }, [operations]);

  const beginOperation = useCallback((kind: 'save' | 'merge') => {
    const token = operations.begin();
    setSaving(kind === 'save');
    setMerging(kind === 'merge');
    setError(null);
    return token;
  }, [operations]);

  const finishOperation = useCallback((token: FetchToken) => {
    if (!operations.isCurrent(token)) return;
    setSaving(false);
    setMerging(false);
  }, [operations]);

  const clearConflict = useCallback(() => {
    retireOperation();
    setConflictData(null);
  }, [retireOperation]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    retireOperation();
    setError(null);
    setConflictData(null);
  }, [retireOperation]);

  const saveDevice = useCallback(async (request: CreateDeviceRequest) => {
    const token = beginOperation('save');
    setConflictData(null);

    try {
      log.info('Saving device', {
        label: request.label,
        fingerprint: request.fingerprint,
        accountCount: request.accounts?.length || 0,
        hasLegacyXpub: !request.accounts?.length && !!request.xpub,
      });

      const result = await createDeviceWithConflictHandling(request);

      if (result.status === 'created') {
        log.info('Device created successfully', { deviceId: result.device.id });
        invalidateDevices();
        refreshSidebar();
        // Accepted writes refresh application data even after their UI retires.
        if (operations.isCurrent(token)) {
          if (onSuccess) onSuccess(result.device.id);
          else navigate('/devices');
        }
      } else if (result.status === 'merged') {
        log.info('Accounts merged into existing device', {
          deviceId: result.result.device.id,
          added: result.result.added,
        });
        invalidateDevices();
        refreshSidebar();
        if (operations.isCurrent(token)) {
          if (onSuccess) onSuccess(result.result.device.id);
          else navigate(`/devices/${result.result.device.id}`);
        }
      } else if (result.status === 'conflict') {
        if (!operations.isCurrent(token)) return;
        log.info('Device conflict detected', {
          existingId: result.conflict.existingDevice.id,
          newAccounts: result.conflict.comparison.newAccounts.length,
          matchingAccounts: result.conflict.comparison.matchingAccounts.length,
          conflictingAccounts: result.conflict.comparison.conflictingAccounts.length,
        });
        setConflictData(result.conflict);
      }
    } catch (err) {
      if (!operations.isCurrent(token)) return;
      log.error('Failed to save device', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to save device. Please try again.');
    } finally {
      finishOperation(token);
    }
  }, [beginOperation, finishOperation, invalidateDevices, navigate, onSuccess, operations, refreshSidebar]);

  const mergeDevice = useCallback(async (request: CreateDeviceRequest) => {
    const token = beginOperation('merge');

    try {
      // Add merge flag to request
      const mergeRequest = { ...request, merge: true };
      const result = await mergeDeviceAccounts(mergeRequest);

      log.info('Accounts merged successfully', {
        deviceId: result.device.id,
        added: result.added,
      });

      invalidateDevices();
      refreshSidebar();
      if (operations.isCurrent(token)) {
        if (onSuccess) onSuccess(result.device.id);
        else navigate(`/devices/${result.device.id}`);
      }
    } catch (err) {
      if (!operations.isCurrent(token)) return;
      log.error('Failed to merge accounts', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to merge accounts. Please try again.');
    } finally {
      finishOperation(token);
    }
  }, [beginOperation, finishOperation, invalidateDevices, navigate, onSuccess, operations, refreshSidebar]);

  return {
    saving,
    merging,
    error,
    conflictData,
    saveDevice,
    mergeDevice,
    clearConflict,
    clearError,
    reset,
  };
}
