import { describe } from 'vitest';

import { registerConnectDeviceDiscoveryContracts } from './ConnectDevice/ConnectDevice.discovery.contracts';
import { registerConnectDeviceImportUsbContracts } from './ConnectDevice/ConnectDevice.import-usb.contracts';
import { registerConnectDeviceSelectionManualContracts } from './ConnectDevice/ConnectDevice.selection-manual.contracts';
import { setupConnectDeviceHarness } from './ConnectDevice/ConnectDeviceTestHarness';

describe('ConnectDevice Component', () => {
  setupConnectDeviceHarness();

  registerConnectDeviceDiscoveryContracts();
  registerConnectDeviceSelectionManualContracts();
  registerConnectDeviceImportUsbContracts();
});
