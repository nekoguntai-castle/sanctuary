import { describe } from 'vitest';

import { registerConnectDeviceDiscoveryContracts } from './ConnectDevice/ConnectDevice.discovery.contracts';
import { registerConnectDeviceImportUsbContracts } from './ConnectDevice/ConnectDevice.import-usb.contracts';
import { registerConnectDeviceSelectionContracts } from './ConnectDevice/ConnectDevice.selection.contracts';
import { setupConnectDeviceHarness } from './ConnectDevice/ConnectDeviceTestHarness';

describe('ConnectDevice Component', () => {
  setupConnectDeviceHarness();

  registerConnectDeviceDiscoveryContracts();
  registerConnectDeviceSelectionContracts();
  registerConnectDeviceImportUsbContracts();
});
