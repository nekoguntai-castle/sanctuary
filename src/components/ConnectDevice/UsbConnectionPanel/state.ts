export interface UsbConnectionFlags {
  showInitial: boolean;
  showError: boolean;
  showScanning: boolean;
  showSuccess: boolean;
}

export function getUsbConnectionFlags(scanning: boolean, scanned: boolean, error: string | null): UsbConnectionFlags {
  return {
    showInitial: !scanning && !scanned && !error,
    showError: !scanning && !scanned && Boolean(error),
    showScanning: scanning,
    showSuccess: scanned && !error,
  };
}

export function getUsbProgressPercent(current: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (current / total) * 100));
}
