/**
 * QRSigningModal Component
 *
 * Two-step modal for QR code-based PSBT signing:
 * 1. Display unsigned PSBT as animated QR for hardware wallet to scan
 * 2. Scan signed PSBT QR from hardware wallet
 */

import React from 'react';
import { QrCode, X } from 'lucide-react';
import { QRSigningDisplayStep } from './QRSigningModal/QRSigningDisplayStep';
import { QRSigningScanStep } from './QRSigningModal/QRSigningScanStep';
import { useQRSigningModalController } from './QRSigningModal/useQRSigningModalController';

interface QRSigningModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Base64-encoded unsigned PSBT */
  psbtBase64: string;
  /** Device label for display */
  deviceLabel: string;
  /** Callback when signed PSBT is received */
  onSignedPsbt: (signedPsbt: string) => void;
}

export const QRSigningModal: React.FC<QRSigningModalProps> = ({
  isOpen,
  onClose,
  psbtBase64,
  deviceLabel,
  onSignedPsbt,
}) => {
  const controller = useQRSigningModalController({ onClose, onSignedPsbt });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={controller.handleClose}
      />
      <div className="relative bg-white dark:bg-sanctuary-800 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-sanctuary-200 dark:border-sanctuary-700">
          <div className="flex items-center">
            <QrCode className="w-5 h-5 text-primary-500 mr-2" />
            <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-white">
              QR Signing - {deviceLabel}
            </h3>
          </div>
          <button
            onClick={controller.handleClose}
            className="p-2 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 transition-colors"
          >
            <X className="w-5 h-5 text-sanctuary-500" />
          </button>
        </div>
        <div className="p-6">
          {controller.step === 'display' ? (
            <QRSigningDisplayStep
              deviceLabel={deviceLabel}
              psbtBase64={psbtBase64}
              onContinue={controller.showScanStep}
            />
          ) : (
            <QRSigningScanStep
              deviceLabel={deviceLabel}
              scanProgress={controller.scanProgress}
              scanError={controller.scanError}
              cameraError={controller.cameraError}
              fileInputRef={controller.fileInputRef}
              onScan={controller.handleQrScan}
              onCameraError={controller.handleCameraError}
              onRetryCamera={controller.retryCamera}
              onFileUpload={controller.handleFileUpload}
              onUploadClick={controller.openFilePicker}
              onBack={controller.showDisplayStep}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default QRSigningModal;
