// Device connection capabilities
import {
  getHardwareWalletCapabilityRow,
  type HardwareWalletVendor,
} from '@sanctuary/shared/constants/hardwareWalletCapabilities';

export type ConnectionMethod = 'usb' | 'airgap' | 'qr';

export interface DeviceCapabilities {
  methods: ConnectionMethod[];
  labels: Record<ConnectionMethod, string>;
  blockedReason: string;
}

const SIGNING_METHODS: Record<HardwareWalletVendor, ConnectionMethod[]> = {
  bitbox: ['usb'],
  coldcard: ['airgap'],
  generic: ['airgap'],
  jade: ['usb'],
  keystone: ['qr', 'airgap'],
  ledger: ['usb'],
  passport: ['qr', 'airgap'],
  seedsigner: ['qr', 'airgap'],
  specter: ['airgap'],
  trezor: ['usb'],
};

const METHOD_LABELS: Record<ConnectionMethod, string> = {
  usb: 'USB',
  airgap: 'PSBT File',
  qr: 'QR Code',
};

export const getDeviceCapabilities = (deviceType: string): DeviceCapabilities => {
  const row = getHardwareWalletCapabilityRow({ type: deviceType }, 'sign');
  // The transport map is inert until its exact manifest row is evidence-enabled.
  const methods = row?.enabled ? SIGNING_METHODS[row.vendor] : [];
  return {
    methods,
    labels: {
      usb: methods.includes('usb') ? METHOD_LABELS.usb : '',
      airgap: methods.includes('airgap') ? METHOD_LABELS.airgap : '',
      qr: methods.includes('qr') ? METHOD_LABELS.qr : '',
    },
    blockedReason: row?.reason
      ?? 'No reviewed hardware-wallet capability row matches this signer identity.',
  };
};
