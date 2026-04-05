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

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { HardwareDeviceModel } from '../../src/api/devices';
import { isSecureContext } from '../../services/hardwareWallet/environment';

// Hooks
import { useDeviceModels } from '../../hooks/useDeviceModels';
import { useDeviceSave } from '../../hooks/useDeviceSave';
import { useQrScanner } from '../../hooks/qr/useQrScanner';
import { useDeviceConnection } from '../../hooks/useDeviceConnection';
import { useDeviceForm } from './hooks/useDeviceForm';

// Utilities
import { getAvailableMethods } from '../../utils/deviceConnection';

// Subcomponents
import { DeviceModelSelector } from './DeviceModelSelector';
import { ConnectionMethodSelector } from './ConnectionMethodSelector';
import { UsbConnectionPanel } from './UsbConnectionPanel';
import { QrScannerPanel } from './QrScannerPanel';
import { FileUploadPanel } from './FileUploadPanel';
import { DeviceDetailsForm } from './DeviceDetailsForm';
import { ConflictDialog } from './ConflictDialog';

export const ConnectDevice: React.FC = () => {
  const navigate = useNavigate();

  // Device model selection
  const [selectedModel, setSelectedModel] = useState<HardwareDeviceModel | null>(null);
  const {
    filteredModels,
    manufacturers,
    loading: loadingModels,
    error: modelsError,
    selectedManufacturer,
    searchQuery,
    setSelectedManufacturer,
    setSearchQuery,
    clearFilters,
  } = useDeviceModels();

  // Device save operations
  const {
    saving,
    merging,
    error: saveError,
    conflictData,
    saveDevice,
    mergeDevice,
    clearConflict,
    reset: resetSave,
  } = useDeviceSave();

  // QR scanning
  const {
    qrMode,
    setQrMode,
    cameraActive,
    setCameraActive,
    cameraError,
    urProgress,
    scanning: qrScanning,
    scanResult,
    error: qrError,
    handleQrScan,
    handleCameraError,
    reset: resetQr,
    stopCamera,
  } = useQrScanner();

  // USB device connection
  const {
    scanning: usbScanning,
    usbProgress,
    connectionResult,
    error: usbError,
    connectUsb,
    reset: resetUsb,
  } = useDeviceConnection();

  // Form state and handlers
  const {
    formData,
    scanned,
    fileScanning,
    warning,
    qrExtractedFields,
    showQrDetails,
    method,
    handleFormDataChange,
    handleToggleAccount,
    handleFileUpload,
    handleSelectMethod,
    handleSave,
    handleMerge,
    setShowQrDetails,
  } = useDeviceForm({
    selectedModel,
    scanResult,
    connectionResult,
    saveDevice,
    mergeDevice,
    resetQr,
    resetUsb,
    resetSave,
  });

  // Get available methods for selected model
  const availableMethods = selectedModel
    ? getAvailableMethods(selectedModel.connectivity, isSecureContext())
    : [];

  // Combined error
  const error = saveError || qrError || usbError || modelsError;

  // Loading state
  if (loadingModels) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-sanctuary-500" />
        <span className="ml-3 text-sanctuary-500">Loading device models...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Back Button */}
      <button
        onClick={() => navigate('/devices')}
        className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Devices
      </button>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Connect Hardware Device</h1>
        <p className="text-sanctuary-500">Add a new signing device to your sanctuary.</p>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Steps 1 & 2 */}
        <div className="lg:col-span-2 space-y-4">
          {/* Step 1: Device Model Selection */}
          <DeviceModelSelector
            models={filteredModels}
            manufacturers={manufacturers}
            selectedModel={selectedModel}
            selectedManufacturer={selectedManufacturer}
            searchQuery={searchQuery}
            onSelectModel={setSelectedModel}
            onSelectManufacturer={setSelectedManufacturer}
            onSearchChange={setSearchQuery}
            onClearFilters={clearFilters}
          />

          {/* Step 2: Connection Method */}
          {selectedModel && (
            <ConnectionMethodSelector
              selectedModel={selectedModel}
              selectedMethod={method}
              availableMethods={availableMethods}
              onSelectMethod={handleSelectMethod}
            />
          )}

          {/* Connection Action Area */}
          {selectedModel && method && (
            <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
              {method === 'usb' && (
                <UsbConnectionPanel
                  selectedModel={selectedModel}
                  scanning={usbScanning}
                  scanned={scanned}
                  error={usbError}
                  usbProgress={usbProgress}
                  parsedAccountsCount={formData.parsedAccounts.length}
                  fingerprint={formData.fingerprint}
                  onConnect={() => connectUsb(selectedModel)}
                />
              )}

              {method === 'sd_card' && (
                <FileUploadPanel
                  selectedModel={selectedModel}
                  scanning={fileScanning}
                  scanned={scanned}
                  onFileUpload={handleFileUpload}
                />
              )}

              {method === 'qr_code' && (
                <QrScannerPanel
                  selectedModel={selectedModel}
                  scanned={scanned}
                  qrMode={qrMode}
                  cameraActive={cameraActive}
                  cameraError={cameraError}
                  urProgress={urProgress}
                  scanning={qrScanning}
                  fingerprint={formData.fingerprint}
                  isSecure={isSecureContext()}
                  onQrModeChange={setQrMode}
                  onCameraActiveChange={setCameraActive}
                  onQrScan={handleQrScan}
                  onCameraError={handleCameraError}
                  onFileUpload={handleFileUpload}
                  onStopCamera={stopCamera}
                />
              )}

              {method === 'manual' && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg flex items-start">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-3 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Manually entering xpubs is for advanced users. Ensure you copy the correct Extended Public Key
                    corresponding to the derivation path. The fingerprint should match your device's master fingerprint.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Step 3 */}
        <div className="space-y-4">
          <DeviceDetailsForm
            selectedModel={selectedModel}
            method={method}
            scanned={scanned}
            formData={formData}
            saving={saving}
            error={error}
            warning={warning}
            qrExtractedFields={qrExtractedFields}
            showQrDetails={showQrDetails}
            onFormDataChange={handleFormDataChange}
            onToggleAccount={handleToggleAccount}
            onToggleQrDetails={() => setShowQrDetails(!showQrDetails)}
            onSave={handleSave}
          />
        </div>
      </div>

      {/* Conflict Dialog */}
      {conflictData && (
        <ConflictDialog
          conflictData={conflictData}
          merging={merging}
          error={saveError}
          onMerge={handleMerge}
          onViewExisting={() => navigate(`/devices/${conflictData.existingDevice.id}`)}
          onCancel={clearConflict}
        />
      )}
    </div>
  );
};
