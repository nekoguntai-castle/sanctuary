/**
 * Monitoring Administration Page
 *
 * Provides easy access to monitoring tools (Grafana, Prometheus, Jaeger)
 * with status indicators and configurable URLs.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Info,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type { MonitoringService, MonitoringServicesResponse, GrafanaConfig } from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';
import { Button } from '../ui/Button';
import { ServiceCard } from './ServiceCard';
import { EditUrlModal } from './EditUrlModal';
import type { ServiceCredentials } from './types';

/**
 * Main Monitoring component - orchestrates service display,
 * credential management, and URL configuration.
 */
export const Monitoring: React.FC = () => {
  const [data, setData] = useState<MonitoringServicesResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Grafana config state
  const [grafanaConfig, setGrafanaConfig] = useState<GrafanaConfig | null>(null);

  // Edit URL modal state
  const [editingService, setEditingService] = useState<MonitoringService | null>(null);
  const [editUrl, setEditUrl] = useState('');

  // Loading states using hook
  const { loading, error, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: isTogglingAnonymous, execute: runToggle } = useLoadingState();
  const { loading: isSaving, error: saveError, execute: runSave, clearError: clearSaveError } = useLoadingState();

  // Get hostname for URL generation
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  const loadServices = useCallback(async (checkHealth = false) => {
    if (checkHealth) setIsRefreshing(true);

    await runLoad(async () => {
      const [servicesResult, grafanaResult] = await Promise.all([
        adminApi.getMonitoringServices(checkHealth),
        adminApi.getGrafanaConfig().catch(() => null), // Non-fatal if fails
      ]);
      setData(servicesResult);
      if (grafanaResult) {
        setGrafanaConfig(grafanaResult);
      }
    });

    setIsRefreshing(false);
  }, [runLoad]);

  useEffect(() => {
    loadServices(true); // Check health on initial load
  }, [loadServices]);

  // Toggle anonymous access for Grafana
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

  // Build credentials map for each service
  const getCredentialsForService = useCallback((serviceId: string): ServiceCredentials | undefined => {
    if (serviceId === 'grafana' && grafanaConfig) {
      return {
        username: grafanaConfig.username,
        password: grafanaConfig.password,
        passwordSource: grafanaConfig.passwordSource,
        hasAuth: true,
      };
    }
    // Prometheus and Jaeger don't have authentication by default
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

  const handleEditUrl = (service: MonitoringService) => {
    setEditingService(service);
    setEditUrl(service.isCustomUrl ? service.url : '');
    clearSaveError();
  };

  const handleCloseModal = () => {
    setEditingService(null);
    setEditUrl('');
    clearSaveError();
  };

  const handleSaveUrl = async () => {
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
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">
              Monitoring
            </h2>
            <p className="text-sanctuary-500">
              Access observability tools for metrics, logs, and tracing
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadServices(true)}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
        </div>
      </div>

      {/* Info banner when monitoring is not enabled */}
      {data && !data.enabled && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <div className="flex items-start space-x-3">
            <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Monitoring Stack Not Enabled
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                To enable monitoring, start Sanctuary with the monitoring compose file:
              </p>
              <code className="block mt-2 text-xs font-mono bg-amber-100 dark:bg-amber-900/40 p-2 rounded text-amber-800 dark:text-amber-200">
                docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
              </code>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
          <div className="flex items-center space-x-2 text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Services Grid */}
      {data && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onEditUrl={handleEditUrl}
              hostname={hostname}
              credentials={getCredentialsForService(service.id)}
              anonymousAccess={service.id === 'grafana' ? grafanaConfig?.anonymousAccess : undefined}
              onToggleAnonymous={service.id === 'grafana' ? handleToggleAnonymous : undefined}
              isTogglingAnonymous={service.id === 'grafana' ? isTogglingAnonymous : undefined}
            />
          ))}
        </div>
      )}

      {/* Info Section */}
      <div className="mt-8 surface-secondary rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-700">
        <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
          About Monitoring
        </h4>
        <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
          The monitoring stack provides observability into Sanctuary's operation:
        </p>
        <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mt-2 space-y-1 list-disc list-inside">
          <li><strong>Grafana</strong> - Pre-configured dashboards for wallet sync, API performance, and system health</li>
          <li><strong>Prometheus</strong> - Metrics collection from backend /metrics endpoint</li>
          <li><strong>Jaeger</strong> - Distributed request tracing (requires OTEL_TRACING_ENABLED=true)</li>
        </ul>
      </div>

      {/* Edit URL Modal */}
      <EditUrlModal
        service={editingService}
        editUrl={editUrl}
        isSaving={isSaving}
        saveError={saveError}
        hostname={hostname}
        onUrlChange={setEditUrl}
        onSave={handleSaveUrl}
        onClose={handleCloseModal}
      />
    </div>
  );
};

export default Monitoring;
