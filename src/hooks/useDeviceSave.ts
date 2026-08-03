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
import { useSidebar } from '../contexts/SidebarContext';
import { createLogger } from '../utils/logger';

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
export function useDeviceSave(): UseDeviceSaveState {
  const navigate = useNavigate();
  const { refreshSidebar } = useSidebar();

  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictData, setConflictData] = useState<DeviceConflictResponse | null>(null);

  const clearConflict = useCallback(() => {
    setConflictData(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setSaving(false);
    setMerging(false);
    setError(null);
    setConflictData(null);
  }, []);

  const saveDevice = useCallback(async (request: CreateDeviceRequest) => {
    setSaving(true);
    setError(null);
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
        refreshSidebar();
        navigate('/devices');
      } else if (result.status === 'merged') {
        log.info('Accounts merged into existing device', {
          deviceId: result.result.device.id,
          added: result.result.added,
        });
        refreshSidebar();
        navigate(`/devices/${result.result.device.id}`);
      } else if (result.status === 'conflict') {
        log.info('Device conflict detected', {
          existingId: result.conflict.existingDevice.id,
          newAccounts: result.conflict.comparison.newAccounts.length,
          matchingAccounts: result.conflict.comparison.matchingAccounts.length,
          conflictingAccounts: result.conflict.comparison.conflictingAccounts.length,
        });
        setConflictData(result.conflict);
      }
    } catch (err) {
      log.error('Failed to save device', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to save device. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [navigate, refreshSidebar]);

  const mergeDevice = useCallback(async (request: CreateDeviceRequest) => {
    setMerging(true);
    setError(null);

    try {
      // Add merge flag to request
      const mergeRequest = { ...request, merge: true };
      const result = await mergeDeviceAccounts(mergeRequest);

      log.info('Accounts merged successfully', {
        deviceId: result.device.id,
        added: result.added,
      });

      refreshSidebar();
      navigate(`/devices/${result.device.id}`);
    } catch (err) {
      log.error('Failed to merge accounts', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to merge accounts. Please try again.');
    } finally {
      setMerging(false);
    }
  }, [navigate, refreshSidebar]);

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
