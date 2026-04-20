import React from 'react';
import { EditUrlModal } from './EditUrlModal';
import { MonitoringAbout } from './MonitoringAbout';
import { MonitoringDisabledBanner } from './MonitoringDisabledBanner';
import { MonitoringErrorBanner } from './MonitoringErrorBanner';
import { MonitoringHeader } from './MonitoringHeader';
import { MonitoringLoadingState } from './MonitoringLoadingState';
import { MonitoringServicesGrid } from './MonitoringServicesGrid';
import { useMonitoringController } from './useMonitoringController';

/**
 * Main Monitoring component - orchestrates service display,
 * credential management, and URL configuration.
 */
export const Monitoring: React.FC = () => {
  const controller = useMonitoringController();

  if (controller.loading) {
    return <MonitoringLoadingState />;
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      <MonitoringHeader
        isRefreshing={controller.isRefreshing}
        onRefresh={() => controller.loadServices(true)}
      />

      <MonitoringDisabledBanner show={Boolean(controller.data && !controller.data.enabled)} />
      <MonitoringErrorBanner error={controller.error} />

      <MonitoringServicesGrid
        data={controller.data}
        hostname={controller.hostname}
        grafanaConfig={controller.grafanaConfig}
        isTogglingAnonymous={controller.isTogglingAnonymous}
        getCredentialsForService={controller.getCredentialsForService}
        onEditUrl={controller.handleEditUrl}
        onToggleAnonymous={controller.handleToggleAnonymous}
      />

      <MonitoringAbout />

      <EditUrlModal
        service={controller.editingService}
        editUrl={controller.editUrl}
        isSaving={controller.isSaving}
        saveError={controller.saveError}
        hostname={controller.hostname}
        onUrlChange={controller.setEditUrl}
        onSave={controller.handleSaveUrl}
        onClose={controller.handleCloseModal}
      />
    </div>
  );
};

export default Monitoring;
