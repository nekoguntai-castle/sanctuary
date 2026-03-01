import React from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Camera, Upload, X, Loader2, AlertCircle } from 'lucide-react';
import { isSecureContext } from '../../../services/hardwareWallet';

interface QrImportProps {
  qrMode: 'camera' | 'file';
  setQrMode: (mode: 'camera' | 'file') => void;
  cameraActive: boolean;
  setCameraActive: (active: boolean) => void;
  cameraError: string | null;
  setCameraError: (error: string | null) => void;
  urProgress: number;
  setUrProgress: (progress: number) => void;
  addAccountLoading: boolean;
  onQrScan: (result: { rawValue: string }[]) => void;
  onCameraError: (error: unknown) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  urDecoderRef: React.MutableRefObject<unknown | null>;
  bytesDecoderRef: React.MutableRefObject<unknown | null>;
}

export const QrImport: React.FC<QrImportProps> = ({
  qrMode,
  setQrMode,
  cameraActive,
  setCameraActive,
  cameraError,
  setCameraError,
  urProgress,
  setUrProgress,
  addAccountLoading,
  onQrScan,
  onCameraError,
  onFileUpload,
  urDecoderRef,
  bytesDecoderRef,
}) => {
  return (
    <div className="space-y-3">
      {/* QR Mode Toggle */}
      <div className="flex justify-center gap-2">
        <button
          onClick={() => { setQrMode('camera'); setCameraError(null); }}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            qrMode === 'camera'
              ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
              : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
          }`}
        >
          <Camera className="w-4 h-4" />
          Camera
        </button>
        <button
          onClick={() => { setQrMode('file'); setCameraActive(false); }}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            qrMode === 'file'
              ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
              : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
          }`}
        >
          <Upload className="w-4 h-4" />
          File
        </button>
      </div>

      {/* Camera Scanner */}
      {qrMode === 'camera' && (
        <div className="surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
          {!cameraActive && !cameraError && (
            <div className="text-center py-6">
              <Camera className="w-10 h-10 mx-auto text-sanctuary-400 mb-3" />
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
                Scan QR code from your device
              </p>
              {!isSecureContext() && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 px-4">
                  Camera requires HTTPS
                </p>
              )}
              <button
                onClick={() => { setCameraActive(true); setCameraError(null); }}
                className="px-6 py-2 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors"
              >
                Start Camera
              </button>
            </div>
          )}
          {cameraActive && (
            <div className="relative">
              <div className="aspect-square max-w-xs mx-auto">
                <Scanner
                  onScan={onQrScan}
                  onError={onCameraError}
                  constraints={{ facingMode: 'environment' }}
                  scanDelay={100}
                  styles={{
                    container: { width: '100%', height: '100%' },
                    video: { width: '100%', height: '100%', objectFit: 'cover' },
                  }}
                />
              </div>
              <button
                onClick={() => { setCameraActive(false); setUrProgress(0); urDecoderRef.current = null; bytesDecoderRef.current = null; }}
                className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-10"
              >
                <X className="w-4 h-4" />
              </button>
              {/* Progress for animated QR */}
              {urProgress > 0 && urProgress < 100 && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-3 z-10">
                  <div className="flex items-center justify-between text-white mb-2">
                    <span className="flex items-center text-sm font-medium">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Scanning...
                    </span>
                    <span className="text-lg font-bold">{urProgress}%</span>
                  </div>
                  <div className="w-full bg-white/20 rounded-full h-2">
                    <div
                      className="bg-green-400 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${urProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {cameraError && (
            <div className="text-center py-6">
              <AlertCircle className="w-10 h-10 mx-auto text-rose-400 mb-3" />
              <p className="text-sm text-rose-600 dark:text-rose-400 mb-4 px-4">
                {cameraError}
              </p>
              <button
                onClick={() => { setCameraActive(true); setCameraError(null); }}
                className="px-6 py-2 rounded-lg bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      )}

      {/* File upload alternative */}
      {qrMode === 'file' && (
        <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
          {addAccountLoading ? (
            <div className="flex flex-col items-center">
              <Loader2 className="w-10 h-10 animate-spin text-sanctuary-500 mb-4" />
              <p className="text-sm text-sanctuary-500">Parsing file...</p>
            </div>
          ) : (
            <>
              <Upload className="w-10 h-10 mx-auto text-sanctuary-400 mb-3" />
              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4">
                Upload QR data file
              </p>
              <label className="cursor-pointer">
                <span className="inline-flex items-center justify-center rounded-lg px-6 py-2 bg-sanctuary-800 text-white text-sm font-medium hover:bg-sanctuary-700 transition-colors">
                  Select File
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".json,.txt"
                  onChange={onFileUpload}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
};
