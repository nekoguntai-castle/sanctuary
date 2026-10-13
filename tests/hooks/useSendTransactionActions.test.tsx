import { describe } from 'vitest';

import { registerUseSendTransactionActionsDraftContracts } from './useSendTransactionActions/useSendTransactionActions.drafts.contracts';
import { registerUseSendTransactionActionsDraftAdoptionContracts } from './useSendTransactionActions/useSendTransactionActions.draftAdoption.contracts';
import { registerUseSendTransactionActionsCreationContracts } from './useSendTransactionActions/useSendTransactionActions.creation.contracts';
import { registerUseSendTransactionActionsSigningContracts } from './useSendTransactionActions/useSendTransactionActions.signing.contracts';
import { setupUseSendTransactionActionsHarness } from './useSendTransactionActions/useSendTransactionActionsTestHarness';

describe('useSendTransactionActions', () => {
  setupUseSendTransactionActionsHarness();

  registerUseSendTransactionActionsCreationContracts();
  registerUseSendTransactionActionsSigningContracts();
  registerUseSendTransactionActionsDraftContracts();
  registerUseSendTransactionActionsDraftAdoptionContracts();
});
