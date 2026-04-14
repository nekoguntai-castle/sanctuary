import { beforeEach, describe } from 'vitest';
import { registerTransferConfirmContracts } from './transferService/transferService.confirm.contracts';
import { registerTransferInitiateContracts } from './transferService/transferService.initiate.contracts';
import { registerTransferQueriesExpiryContracts } from './transferService/transferService.queries-expiry.contracts';
import { registerTransferStateChangeContracts } from './transferService/transferService.state-changes.contracts';
import { setupTransferServiceMocks } from './transferService/transferServiceTestHarness';

describe('Transfer Service', () => {
  beforeEach(setupTransferServiceMocks);

  registerTransferInitiateContracts();
  registerTransferStateChangeContracts();
  registerTransferConfirmContracts();
  registerTransferQueriesExpiryContracts();
});
