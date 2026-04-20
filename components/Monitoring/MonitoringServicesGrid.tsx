import React from 'react';
import type { GrafanaConfig, MonitoringService, MonitoringServicesResponse } from '../../src/api/admin';
import { ServiceCard } from './ServiceCard';
import type { ServiceCredentials } from './types';

interface MonitoringServicesGridProps {
  data: MonitoringServicesResponse | null;
  hostname: string;
  grafanaConfig: GrafanaConfig | null;
  isTogglingAnonymous: boolean;
  getCredentialsForService: (serviceId: string) => ServiceCredentials | undefined;
  onEditUrl: (service: MonitoringService) => void;
  onToggleAnonymous: () => void;
}

const isGrafana = (service: MonitoringService) => service.id === 'grafana';

export const MonitoringServicesGrid: React.FC<MonitoringServicesGridProps> = ({
  data,
  hostname,
  grafanaConfig,
  isTogglingAnonymous,
  getCredentialsForService,
  onEditUrl,
  onToggleAnonymous,
}) => {
  if (!data) {
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.services.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
          onEditUrl={onEditUrl}
          hostname={hostname}
          credentials={getCredentialsForService(service.id)}
          anonymousAccess={isGrafana(service) ? grafanaConfig?.anonymousAccess : undefined}
          onToggleAnonymous={isGrafana(service) ? onToggleAnonymous : undefined}
          isTogglingAnonymous={isGrafana(service) ? isTogglingAnonymous : undefined}
        />
      ))}
    </div>
  );
};
