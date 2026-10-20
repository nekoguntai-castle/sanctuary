import { describe } from 'vitest';

import { registerUseSendTransactionActionsDraftContracts } from './useSendTransactionActions/useSendTransactionActions.drafts.contracts';
import { registerUseSendTransactionActionsDraftAdoptionContracts } from './useSendTransactionActions/useSendTransactionActions.draftAdoption.contracts';
import { registerUseSendTransactionActionsCreationContracts } from './useSendTransactionActions/useSendTransactionActions.creation.contracts';
import { registerUseSendTransactionActionsSigningContracts } from './useSendTransactionActions/useSendTransactionActions.signing.contracts';
import { registerUseSendTransactionActionsPayjoinRoundOneContracts } from './useSendTransactionActions/useSendTransactionActions.payjoinRoundOne.contracts';
import { registerUseSendTransactionActionsPayjoinFallbackContracts } from './useSendTransactionActions/useSendTransactionActions.payjoinFallback.contracts';
import { registerUseSendTransactionActionsPayjoinRoundTwoContracts } from './useSendTransactionActions/useSendTransactionActions.payjoinRoundTwo.contracts';
import { setupUseSendTransactionActionsHarness } from './useSendTransactionActions/useSendTransactionActionsTestHarness';

describe('useSendTransactionActions', () => {
  setupUseSendTransactionActionsHarness();

  registerUseSendTransactionActionsCreationContracts();
  registerUseSendTransactionActionsSigningContracts();
  registerUseSendTransactionActionsDraftContracts();
  registerUseSendTransactionActionsDraftAdoptionContracts();
  registerUseSendTransactionActionsPayjoinRoundOneContracts();
  registerUseSendTransactionActionsPayjoinRoundTwoContracts();
  registerUseSendTransactionActionsPayjoinFallbackContracts();
});
