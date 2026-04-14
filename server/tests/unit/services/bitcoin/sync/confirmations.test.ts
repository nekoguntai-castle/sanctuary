import { describe } from 'vitest';

import { registerPopulateMissingTransactionFieldsAddressIdContracts } from './confirmations/confirmations.populate-address-id.contracts';
import { registerPopulateMissingTransactionFieldsCoreContracts } from './confirmations/confirmations.populate-core.contracts';
import { registerPopulateMissingTransactionFieldsCounterpartyFallbacksContracts } from './confirmations/confirmations.populate-counterparty-fallbacks.contracts';
import { registerPopulateMissingTransactionFieldsErrorHandlingContracts } from './confirmations/confirmations.populate-error-handling.contracts';
import { registerPopulateMissingTransactionFieldsMainFlowContracts } from './confirmations/confirmations.populate-main-flow.contracts';
import { registerPopulateMissingTransactionFieldsMixedFallbacksContracts } from './confirmations/confirmations.populate-mixed-fallbacks.contracts';
import { registerPopulateMissingTransactionFieldsNetworkHistoryContracts } from './confirmations/confirmations.populate-network-history.contracts';
import { registerConfirmationsTestHarness } from './confirmations/confirmationsTestHarness';
import { registerUpdateTransactionConfirmationsContracts } from './confirmations/confirmations.update.contracts';

describe('confirmations service', () => {
  registerConfirmationsTestHarness();

  describe('updateTransactionConfirmations', () => {
    registerUpdateTransactionConfirmationsContracts();
  });

  describe('populateMissingTransactionFields', () => {
    registerPopulateMissingTransactionFieldsCoreContracts();
    registerPopulateMissingTransactionFieldsMainFlowContracts();
    registerPopulateMissingTransactionFieldsAddressIdContracts();
    registerPopulateMissingTransactionFieldsErrorHandlingContracts();
    registerPopulateMissingTransactionFieldsMixedFallbacksContracts();
    registerPopulateMissingTransactionFieldsNetworkHistoryContracts();
    registerPopulateMissingTransactionFieldsCounterpartyFallbacksContracts();
  });
});
