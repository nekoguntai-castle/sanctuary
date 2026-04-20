import type { ChangeEvent, MutableRefObject } from 'react';
import type { QrMode } from '../types';

export interface QrImportProps {
  qrMode: QrMode;
  setQrMode: (mode: QrMode) => void;
  cameraActive: boolean;
  setCameraActive: (active: boolean) => void;
  cameraError: string | null;
  setCameraError: (error: string | null) => void;
  urProgress: number;
  setUrProgress: (progress: number) => void;
  addAccountLoading: boolean;
  onQrScan: (result: { rawValue: string }[]) => void;
  onCameraError: (error: unknown) => void;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  urDecoderRef: MutableRefObject<unknown | null>;
  bytesDecoderRef: MutableRefObject<unknown | null>;
}
