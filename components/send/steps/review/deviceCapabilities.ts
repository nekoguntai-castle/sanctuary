// Device connection capabilities
export type ConnectionMethod = 'usb' | 'airgap' | 'qr';

export interface DeviceCapabilities {
  methods: ConnectionMethod[];
  labels: Record<ConnectionMethod, string>;
}

export const getDeviceCapabilities = (deviceType: string): DeviceCapabilities => {
  const normalizedType = deviceType.toLowerCase();

  if (normalizedType.includes('coldcard')) {
    // ColdCard does not support USB signing - only air-gapped PSBT file signing
    return { methods: ['airgap'], labels: { usb: '', airgap: 'PSBT File', qr: '' } };
  }
  if (normalizedType.includes('ledger') || normalizedType.includes('trezor') || normalizedType.includes('bitbox') || normalizedType.includes('jade')) {
    return { methods: ['usb'], labels: { usb: 'USB', airgap: '', qr: '' } };
  }
  if (normalizedType.includes('passport') || normalizedType.includes('foundation') || normalizedType.includes('keystone') || normalizedType.includes('seedsigner')) {
    return { methods: ['qr', 'airgap'], labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' } };
  }
  return { methods: ['usb', 'airgap'], labels: { usb: 'USB', airgap: 'PSBT File', qr: '' } };
};
