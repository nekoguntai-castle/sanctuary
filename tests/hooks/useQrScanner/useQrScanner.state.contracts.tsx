import { act } from '@testing-library/react';
import { expect, it } from 'vitest';

import { renderUseQrScanner } from './useQrScannerTestHarness';

export function registerInitialStateContracts() {
  it('should have correct initial state', () => {
    const { result } = renderUseQrScanner();

    expect(result.current.qrMode).toBe('camera');
    expect(result.current.cameraActive).toBe(false);
    expect(result.current.cameraError).toBeNull();
    expect(result.current.urProgress).toBe(0);
    expect(result.current.scanning).toBe(false);
    expect(result.current.scanResult).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should provide all required functions', () => {
    const { result } = renderUseQrScanner();

    expect(typeof result.current.setQrMode).toBe('function');
    expect(typeof result.current.setCameraActive).toBe('function');
    expect(typeof result.current.handleQrScan).toBe('function');
    expect(typeof result.current.handleCameraError).toBe('function');
    expect(typeof result.current.handleFileContent).toBe('function');
    expect(typeof result.current.reset).toBe('function');
    expect(typeof result.current.stopCamera).toBe('function');
  });
}

export function registerQrModeSwitchingContracts() {
  it('should switch to file mode', () => {
    const { result } = renderUseQrScanner();

    act(() => {
      result.current.setQrMode('file');
    });

    expect(result.current.qrMode).toBe('file');
    expect(result.current.cameraActive).toBe(false);
  });

  it('should switch to camera mode and clear camera error', () => {
    const { result } = renderUseQrScanner();

    // First set an error and switch to file
    act(() => {
      result.current.handleCameraError(new Error('Test error'));
      result.current.setQrMode('file');
    });

    expect(result.current.cameraError).not.toBeNull();

    // Switch back to camera
    act(() => {
      result.current.setQrMode('camera');
    });

    expect(result.current.qrMode).toBe('camera');
    expect(result.current.cameraError).toBeNull();
  });

  it('should deactivate camera when switching to file mode', () => {
    const { result } = renderUseQrScanner();

    act(() => {
      result.current.setCameraActive(true);
    });

    expect(result.current.cameraActive).toBe(true);

    act(() => {
      result.current.setQrMode('file');
    });

    expect(result.current.cameraActive).toBe(false);
  });
}

export function registerCameraStateContracts() {
  it('should toggle camera active state', () => {
    const { result } = renderUseQrScanner();

    act(() => {
      result.current.setCameraActive(true);
    });

    expect(result.current.cameraActive).toBe(true);

    act(() => {
      result.current.setCameraActive(false);
    });

    expect(result.current.cameraActive).toBe(false);
  });
}

export function registerCameraErrorHandlingContracts() {
  it('should handle NotAllowedError', () => {
    const { result } = renderUseQrScanner();

    const error = new Error('Permission denied');
    error.name = 'NotAllowedError';

    act(() => {
      result.current.setCameraActive(true);
      result.current.handleCameraError(error);
    });

    expect(result.current.cameraActive).toBe(false);
    expect(result.current.cameraError).toBe(
      'Camera access denied. Please allow camera permissions and try again.'
    );
  });

  it('should handle NotFoundError', () => {
    const { result } = renderUseQrScanner();

    const error = new Error('No camera');
    error.name = 'NotFoundError';

    act(() => {
      result.current.handleCameraError(error);
    });

    expect(result.current.cameraError).toBe('No camera found on this device.');
  });

  it('should handle generic Error', () => {
    const { result } = renderUseQrScanner();

    act(() => {
      result.current.handleCameraError(new Error('Generic camera issue'));
    });

    expect(result.current.cameraError).toBe('Camera error: Generic camera issue');
  });

  it('should handle non-Error objects', () => {
    const { result } = renderUseQrScanner();

    act(() => {
      result.current.handleCameraError('Some string error');
    });

    expect(result.current.cameraError).toBe(
      'Failed to access camera. Make sure you are using HTTPS.'
    );
  });
}

export function registerResetFunctionalityContracts() {
  it('should reset all state', () => {
    const { result } = renderUseQrScanner();

    // Set various state values
    act(() => {
      result.current.setQrMode('file');
      result.current.setCameraActive(true);
      result.current.handleCameraError(new Error('Test'));
    });

    // Reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.qrMode).toBe('camera');
    expect(result.current.cameraActive).toBe(false);
    expect(result.current.cameraError).toBeNull();
    expect(result.current.urProgress).toBe(0);
    expect(result.current.scanning).toBe(false);
    expect(result.current.scanResult).toBeNull();
    expect(result.current.error).toBeNull();
  });
}

export function registerStopCameraFunctionalityContracts() {
  it('should stop camera without full reset', () => {
    const { result } = renderUseQrScanner();

    act(() => {
      result.current.setQrMode('file');
      result.current.setCameraActive(true);
    });

    act(() => {
      result.current.stopCamera();
    });

    expect(result.current.cameraActive).toBe(false);
    expect(result.current.urProgress).toBe(0);
    // Mode should be preserved
    expect(result.current.qrMode).toBe('file');
  });
}
