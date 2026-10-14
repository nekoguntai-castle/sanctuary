import { beforeEach, describe } from 'vitest';
import { registerBroadcastAndSaveClaimStateContracts } from './transactionServiceBroadcast.broadcastAndSave.claim-states.contracts';
import { registerBroadcastAndSaveCoreContracts } from './transactionServiceBroadcast.broadcastAndSave.core.contracts';
import { registerBroadcastAndSaveFailureTagContracts } from './transactionServiceBroadcast.broadcastAndSave.failure-tags.contracts';
import { registerBroadcastAndSaveFailureAndRbfContracts } from './transactionServiceBroadcast.broadcastAndSave.failures-rbf.contracts';
import { registerBroadcastAndSaveNotificationContracts } from './transactionServiceBroadcast.broadcastAndSave.notifications.contracts';
import { setupBroadcastAndSaveDefaults } from './transactionServiceBroadcast.broadcastAndSave.shared';

export const registerBroadcastAndSaveTests = () => {
  describe('broadcastAndSave', () => {
    beforeEach(setupBroadcastAndSaveDefaults);

    registerBroadcastAndSaveCoreContracts();
    registerBroadcastAndSaveClaimStateContracts();
    registerBroadcastAndSaveNotificationContracts();
    registerBroadcastAndSaveFailureAndRbfContracts();
    registerBroadcastAndSaveFailureTagContracts();
  });
};
