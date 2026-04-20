import { useCallback, useEffect, useState } from 'react';
import * as adminApi from '../../src/api/admin';
import type { GrafanaConfig, MonitoringService, MonitoringServicesResponse } from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';
import type { ServiceCredentials } from './types';

const getHostname = () => (
  typeof window !== 'undefined' ? window.location.hostname : 'localhost'
);

export const useMonitoringController = () => {
  const [data, setData] = useState<MonitoringServicesResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [grafanaConfig, setGrafanaConfig] = useState<GrafanaConfig | null>(null);
  const [editingService, setEditingService] = useState<MonitoringService | null>(null);
  const [editUrl, setEditUrl] = useState('');

  const { loading, error, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: isTogglingAnonymous, execute: runToggle } = useLoadingState();
  const { loading: isSaving, error: saveError, execute: runSave, clearError: clearSaveError } = useLoadingState();

  const loadServices = useCallback(async (checkHealth = false) => {
    if (checkHealth) setIsRefreshing(true);

    await runLoad(async () => {
      const [servicesResult, grafanaResult] = await Promise.all([
        adminApi.getMonitoringServices(checkHealth),
        adminApi.getGrafanaConfig().catch(() => null),
      ]);
      setData(servicesResult);
      if (grafanaResult) {
        setGrafanaConfig(grafanaResult);
      }
    });

    setIsRefreshing(false);
  }, [runLoad]);

  useEffect(() => {
    loadServices(true);
  }, [loadServices]);

  const handleToggleAnonymous = useCallback(async () => {
    if (!grafanaConfig) return;

    const newValue = !grafanaConfig.anonymousAccess;
    const result = await runToggle(async () => {
      await adminApi.updateGrafanaConfig({ anonymousAccess: newValue });
    });

    if (result !== null) {
      setGrafanaConfig({ ...grafanaConfig, anonymousAccess: newValue });
    }
  }, [grafanaConfig, runToggle]);

  const getCredentialsForService = useCallback((serviceId: string): ServiceCredentials | undefined => {
    if (serviceId === 'grafana' && grafanaConfig) {
      return {
        username: grafanaConfig.username,
        password: grafanaConfig.password,
        passwordSource: grafanaConfig.passwordSource,
        hasAuth: true,
      };
    }

    if (serviceId === 'prometheus' || serviceId === 'jaeger') {
      return {
        username: '',
        password: '',
        passwordSource: '',
        hasAuth: false,
      };
    }

    return undefined;
  }, [grafanaConfig]);

  const handleEditUrl = useCallback((service: MonitoringService) => {
    setEditingService(service);
    setEditUrl(service.isCustomUrl ? service.url : '');
    clearSaveError();
  }, [clearSaveError]);

  const handleCloseModal = useCallback(() => {
    setEditingService(null);
    setEditUrl('');
    clearSaveError();
  }, [clearSaveError]);

  const handleSaveUrl = useCallback(async () => {
    if (!editingService) return;

    const result = await runSave(async () => {
      await adminApi.updateMonitoringServiceUrl(
        editingService.id,
        editUrl.trim() || null
      );
    });

    if (result !== null) {
      await loadServices(false);
      handleCloseModal();
    }
  }, [editUrl, editingService, handleCloseModal, loadServices, runSave]);

  return {
    data,
    isRefreshing,
    grafanaConfig,
    editingService,
    editUrl,
    loading,
    error,
    isTogglingAnonymous,
    isSaving,
    saveError,
    hostname: getHostname(),
    loadServices,
    setEditUrl,
    handleToggleAnonymous,
    getCredentialsForService,
    handleEditUrl,
    handleCloseModal,
    handleSaveUrl,
  };
};
