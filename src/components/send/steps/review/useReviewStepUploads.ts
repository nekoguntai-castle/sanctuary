import React, { useCallback } from 'react';
import type { Device } from '../../../../types';
import { createLogger } from '../../../../utils/logger';

const log = createLogger('ReviewStep');

interface UseReviewStepUploadsParams {
  devices: Device[];
  onUploadSignedPsbt?: (file: File, deviceId?: string, deviceFingerprint?: string) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  deviceFileInputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  setUploadingDeviceId: (deviceId: string | null) => void;
}

function getInputFile(event: React.ChangeEvent<HTMLInputElement>): File | undefined {
  return event.target.files?.[0];
}

function resetInput(input: HTMLInputElement | null | undefined): void {
  if (input) input.value = '';
}

function getDeviceFingerprint(devices: Device[], deviceId: string): string | undefined {
  return devices.find(device => device.id === deviceId)?.fingerprint;
}

export function useReviewStepUploads({
  devices,
  onUploadSignedPsbt,
  fileInputRef,
  deviceFileInputRefs,
  setUploadingDeviceId,
}: UseReviewStepUploadsParams) {
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = getInputFile(event);

    if (file && onUploadSignedPsbt) {
      await onUploadSignedPsbt(file);
    }

    resetInput(fileInputRef.current);
  }, [fileInputRef, onUploadSignedPsbt]);

  const handleDeviceFileUpload = useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>,
    deviceId: string
  ) => {
    const file = getInputFile(event);
    const fingerprint = getDeviceFingerprint(devices, deviceId);

    log.debug('handleDeviceFileUpload called', {
      deviceId,
      fingerprint,
      hasFile: Boolean(file),
      hasCallback: Boolean(onUploadSignedPsbt),
    });

    if (file && onUploadSignedPsbt) {
      log.debug('Calling onUploadSignedPsbt', { fileName: file.name, fileSize: file.size, fingerprint });
      setUploadingDeviceId(deviceId);

      try {
        await onUploadSignedPsbt(file, deviceId, fingerprint);
        log.debug('onUploadSignedPsbt completed');
      } catch (error: unknown) {
        log.error('onUploadSignedPsbt failed', { error });
        if (error instanceof Error) alert(error.message);
      } finally {
        setUploadingDeviceId(null);
      }
    } else {
      log.debug('Upload skipped - no file or no callback');
    }

    resetInput(deviceFileInputRefs.current[deviceId]);
  }, [deviceFileInputRefs, devices, onUploadSignedPsbt, setUploadingDeviceId]);

  return {
    handleFileUpload,
    handleDeviceFileUpload,
  };
}
