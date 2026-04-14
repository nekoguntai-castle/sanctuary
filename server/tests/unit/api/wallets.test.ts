import { beforeAll, beforeEach, describe } from 'vitest';
import { registerWalletAnalyticsContracts } from './wallets/wallets.analytics.contracts';
import { registerWalletCrudContracts } from './wallets/wallets.crud.contracts';
import { registerWalletDeviceXpubContracts } from './wallets/wallets.device-xpub.contracts';
import { registerWalletExportMappingContracts } from './wallets/wallets.export-mapping.contracts';
import { registerWalletImportExportContracts } from './wallets/wallets.import-export.contracts';
import { registerWalletSharingContracts } from './wallets/wallets.sharing.contracts';
import { setupWalletsApiApp, setupWalletsApiMocks } from './wallets/walletsTestHarness';

describe('Wallets API', () => {
  beforeAll(setupWalletsApiApp);
  beforeEach(setupWalletsApiMocks);

  registerWalletCrudContracts();
  registerWalletAnalyticsContracts();
  registerWalletSharingContracts();
  registerWalletImportExportContracts();
  registerWalletDeviceXpubContracts();
  registerWalletExportMappingContracts();
});
