import React from 'react';
import { ConflictDialog } from '../ConflictDialog';
import { ConnectionMethodSelector } from '../ConnectionMethodSelector';
import { DeviceDetailsForm } from '../DeviceDetailsForm';
import { DeviceModelSelector } from '../DeviceModelSelector';
import { ConnectionActionPanel } from './ConnectionActionPanel';
import { ConnectDeviceHeader } from './ConnectDeviceHeader';
import type { ConnectDeviceController } from './useConnectDeviceController';

interface ConnectDeviceContentProps {
  controller: ConnectDeviceController;
  onBack: () => void;
  onViewExistingDevice: (deviceId: string) => void;
}

export const ConnectDeviceContent: React.FC<ConnectDeviceContentProps> = ({
  controller,
  onBack,
  onViewExistingDevice,
}) => {
  const { form, models, qr, save, selectedModel, setSelectedModel, usb } = controller;
  const conflictData = save.conflictData;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12">
      <ConnectDeviceHeader onBack={onBack} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <DeviceModelSelector
            models={models.filteredModels}
            manufacturers={models.manufacturers}
            selectedModel={selectedModel}
            selectedManufacturer={models.selectedManufacturer}
            searchQuery={models.searchQuery}
            onSelectModel={setSelectedModel}
            onSelectManufacturer={models.setSelectedManufacturer}
            onSearchChange={models.setSearchQuery}
            onClearFilters={models.clearFilters}
          />

          {selectedModel && (
            <ConnectionMethodSelector
              selectedModel={selectedModel}
              selectedMethod={form.method}
              availableMethods={controller.availableMethods}
              onSelectMethod={form.handleSelectMethod}
            />
          )}

          {selectedModel && form.method && (
            <ConnectionActionPanel
              selectedModel={selectedModel}
              method={form.method}
              scanned={form.scanned}
              fileScanning={form.fileScanning}
              formData={form.formData}
              usbScanning={usb.scanning}
              usbProgress={usb.usbProgress}
              usbError={usb.error}
              qrMode={qr.qrMode}
              cameraActive={qr.cameraActive}
              cameraError={qr.cameraError}
              urProgress={qr.urProgress}
              qrScanning={qr.scanning}
              isSecure={controller.secureContext}
              onConnectUsb={usb.connectUsb}
              onFileUpload={form.handleFileUpload}
              onQrModeChange={qr.setQrMode}
              onCameraActiveChange={qr.setCameraActive}
              onQrScan={qr.handleQrScan}
              onCameraError={qr.handleCameraError}
              onStopCamera={qr.stopCamera}
            />
          )}
        </div>

        <div className="space-y-4">
          <DeviceDetailsForm
            selectedModel={selectedModel}
            method={form.method}
            scanned={form.scanned}
            formData={form.formData}
            saving={save.saving}
            error={controller.error}
            warning={form.warning}
            qrExtractedFields={form.qrExtractedFields}
            showQrDetails={form.showQrDetails}
            onFormDataChange={form.handleFormDataChange}
            onToggleAccount={form.handleToggleAccount}
            onToggleQrDetails={form.toggleQrDetails}
            onSave={form.handleSave}
          />
        </div>
      </div>

      {conflictData && (
        <ConflictDialog
          conflictData={conflictData}
          merging={save.merging}
          error={save.error}
          onMerge={form.handleMerge}
          onViewExisting={() => onViewExistingDevice(conflictData.existingDevice.id)}
          onCancel={save.clearConflict}
        />
      )}
    </div>
  );
};
