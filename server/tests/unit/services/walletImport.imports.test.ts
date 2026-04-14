import { beforeEach, describe } from 'vitest';
import './walletImport.setup';
import { setupBeforeEach } from './walletImport.setup';
import { registerWalletImportAutoDetectContracts } from './walletImportImports/walletImportImports.auto-detect.contracts';
import { registerWalletImportDescriptorContracts } from './walletImportImports/walletImportImports.descriptor.contracts';
import { registerWalletImportJsonContracts } from './walletImportImports/walletImportImports.json.contracts';
import { registerWalletImportParsedContracts } from './walletImportImports/walletImportImports.parsed.contracts';

describe('Wallet Import Service - Imports', () => {
  beforeEach(setupBeforeEach);

  registerWalletImportDescriptorContracts();
  registerWalletImportJsonContracts();
  registerWalletImportParsedContracts();
  registerWalletImportAutoDetectContracts();
});
