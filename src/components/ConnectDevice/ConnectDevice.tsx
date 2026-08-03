/**
 * ConnectDevice Orchestrator Component
 *
 * Main component for connecting hardware wallet devices.
 * Orchestrates the multi-step flow:
 * 1. Select device model
 * 2. Choose connection method (USB, SD Card, QR, Manual)
 * 3. Enter device details
 * 4. Save device (with conflict handling)
 *
 * This is a refactored version that delegates state to custom hooks
 * and UI to subcomponents for better maintainability.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ConnectDeviceContent } from './ConnectDeviceFlow/ConnectDeviceContent';
import { ConnectDeviceLoadingState } from './ConnectDeviceFlow/ConnectDeviceLoadingState';
import { useConnectDeviceController } from './ConnectDeviceFlow/useConnectDeviceController';

export const ConnectDevice: React.FC = () => {
  const navigate = useNavigate();
  const controller = useConnectDeviceController();

  if (controller.models.loading) {
    return <ConnectDeviceLoadingState />;
  }

  return (
    <ConnectDeviceContent
      controller={controller}
      onBack={() => navigate('/devices')}
      onViewExistingDevice={(deviceId) => navigate(`/devices/${deviceId}`)}
    />
  );
};
