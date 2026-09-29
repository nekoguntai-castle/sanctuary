/**
 * ConnectDevice Orchestrator Component
 *
 * Main component for connecting hardware wallet devices.
 * Orchestrates the multi-step flow:
 * 1. Select device model
 * 2. Choose a verified connection method (USB, SD Card, or QR)
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

interface ConnectDeviceProps {
  embedded?: boolean;
  onBack?: () => void;
  onComplete?: (deviceId: string) => void;
}

export const ConnectDevice: React.FC<ConnectDeviceProps> = ({ embedded = false, onBack, onComplete }) => {
  const navigate = useNavigate();
  const controller = useConnectDeviceController(onComplete);
  const handleBack = onBack ?? (() => navigate('/devices'));

  if (controller.models.loading) {
    return <>
      {embedded && <button type="button" onClick={handleBack}>Return to Signers</button>}
      <ConnectDeviceLoadingState />
    </>;
  }

  return (
    <ConnectDeviceContent
      controller={controller}
      onBack={handleBack}
      embedded={embedded}
      onViewExistingDevice={(deviceId) => navigate(`/devices/${deviceId}`)}
    />
  );
};
