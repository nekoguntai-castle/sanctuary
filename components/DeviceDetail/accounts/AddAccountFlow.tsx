import React from 'react';
import { X, Usb, QrCode, HardDrive, Edit2 } from 'lucide-react';
import { isSecureContext } from '../../../services/hardwareWallet';
import { ManualAccountForm } from '../ManualAccountForm';
import { ImportReview } from './ImportReview';
import { UsbImport } from './UsbImport';
import { QrImport } from './QrImport';
import { FileImport } from './FileImport';
import { useAddAccountFlow, getDeviceTypeFromDeviceModel } from './hooks/useAddAccountFlow';
import type { AddAccountFlowProps } from './types';

export const AddAccountFlow: React.FC<AddAccountFlowProps> = (props) => {
  const { device, onClose } = props;

  const {
    addAccountMethod,
    setAddAccountMethod,
    addAccountLoading,
    addAccountError,
    setAddAccountError,
    usbProgress,
    handleAddAccountsViaUsb,
    manualAccount,
    setManualAccount,
    handleAddAccountManually,
    qrMode,
    setQrMode,
    cameraActive,
    setCameraActive,
    cameraError,
    setCameraError,
    urProgress,
    setUrProgress,
    urDecoderRef,
    bytesDecoderRef,
    handleQrScan,
    handleCameraError,
    parsedAccounts,
    selectedParsedAccounts,
    setSelectedParsedAccounts,
    accountConflict,
    handleAddParsedAccounts,
    resetImportState,
    handleFileUpload,
  } = useAddAccountFlow(props);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full shadow-xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-50">
              Add Derivation Path
            </h3>
            <button
              onClick={() => {
                resetImportState();
                onClose();
              }}
              className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {!addAccountMethod ? (
            <div className="space-y-3">
              <p className="text-sm text-sanctuary-500 mb-4">
                Choose how to add a new derivation path to this device.
              </p>

              {/* USB Option */}
              {isSecureContext() && getDeviceTypeFromDeviceModel(device) && (
                <button
                  onClick={() => setAddAccountMethod('usb')}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
                >
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Usb className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                      Connect via USB
                    </p>
                    <p className="text-xs text-sanctuary-500">
                      Fetch all derivation paths from device
                    </p>
                  </div>
                </button>
              )}

              {/* SD Card Option */}
              <button
                onClick={() => { setAddAccountMethod('sdcard'); resetImportState(); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <HardDrive className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    Import from SD Card
                  </p>
                  <p className="text-xs text-sanctuary-500">
                    Upload export file from device
                  </p>
                </div>
              </button>

              {/* QR Code Option */}
              <button
                onClick={() => { setAddAccountMethod('qr'); resetImportState(); }}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <QrCode className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    Scan QR Code
                  </p>
                  <p className="text-xs text-sanctuary-500">
                    Scan animated or static QR codes
                  </p>
                </div>
              </button>

              {/* Manual Option */}
              <button
                onClick={() => setAddAccountMethod('manual')}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800">
                  <Edit2 className="w-5 h-5 text-sanctuary-600 dark:text-sanctuary-400" />
                </div>
                <div>
                  <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    Enter Manually
                  </p>
                  <p className="text-xs text-sanctuary-500">
                    Enter derivation path and xpub
                  </p>
                </div>
              </button>
            </div>
          ) : parsedAccounts.length > 0 ? (
            <ImportReview
              parsedAccounts={parsedAccounts}
              selectedParsedAccounts={selectedParsedAccounts}
              setSelectedParsedAccounts={setSelectedParsedAccounts}
              accountConflict={accountConflict}
              addAccountLoading={addAccountLoading}
              onAddParsedAccounts={handleAddParsedAccounts}
            />
          ) : addAccountMethod === 'usb' ? (
            <UsbImport
              deviceType={device.type}
              addAccountLoading={addAccountLoading}
              usbProgress={usbProgress}
              onConnect={handleAddAccountsViaUsb}
            />
          ) : addAccountMethod === 'sdcard' ? (
            <FileImport
              deviceType={device.type}
              addAccountLoading={addAccountLoading}
              onFileUpload={handleFileUpload}
            />
          ) : addAccountMethod === 'qr' ? (
            <QrImport
              qrMode={qrMode}
              setQrMode={setQrMode}
              cameraActive={cameraActive}
              setCameraActive={setCameraActive}
              cameraError={cameraError}
              setCameraError={setCameraError}
              urProgress={urProgress}
              setUrProgress={setUrProgress}
              addAccountLoading={addAccountLoading}
              onQrScan={handleQrScan}
              onCameraError={handleCameraError}
              onFileUpload={handleFileUpload}
              urDecoderRef={urDecoderRef}
              bytesDecoderRef={bytesDecoderRef}
            />
          ) : addAccountMethod === 'manual' ? (
            <ManualAccountForm
              account={manualAccount}
              onChange={setManualAccount}
              onSubmit={handleAddAccountManually}
              loading={addAccountLoading}
            />
          ) : null}

          {/* Error Message */}
          {addAccountError && (
            <p className="mt-4 text-center text-sm text-rose-600 dark:text-rose-400">
              {addAccountError}
            </p>
          )}

          {/* Back button when in a method */}
          {addAccountMethod && !addAccountLoading && (
            <button
              onClick={() => {
                setAddAccountMethod(null);
                setAddAccountError(null);
                resetImportState();
              }}
              className="mt-4 w-full text-center text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300"
            >
              ← Back to options
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
