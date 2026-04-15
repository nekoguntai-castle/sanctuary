import type { DeviceWithWallets } from '../../../components/cells/DeviceCells';
import type { HardwareDeviceModel, TableColumnConfig } from '../../../types';

export const baseColumn: TableColumnConfig = { id: 'label', label: 'Label' };

export const makeDeviceModel = (
  overrides: Partial<HardwareDeviceModel> = {}
): HardwareDeviceModel => ({
  id: 'model-passport',
  slug: 'passport',
  manufacturer: 'Foundation',
  name: 'Passport',
  connectivity: ['usb'],
  secureElement: true,
  openSource: true,
  airGapped: true,
  supportsBitcoinOnly: true,
  supportsMultisig: true,
  supportsTaproot: true,
  supportsPassphrase: true,
  scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
  hasScreen: true,
  integrationTested: true,
  discontinued: false,
  ...overrides,
});

export const baseDevice: DeviceWithWallets = {
  id: 'device-1',
  type: 'passport',
  label: 'Passport',
  fingerprint: 'abcd1234',
  isOwner: true,
  accounts: [],
  wallets: [],
};
