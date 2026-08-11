import { beforeEach, describe } from 'vitest';
import { registerBroadcastAndSaveCoreContracts } from './transactionServiceBroadcast.broadcastAndSave.core.contracts';
import { registerBroadcastAndSaveFailureAndRbfContracts } from './transactionServiceBroadcast.broadcastAndSave.failures-rbf.contracts';
import { registerBroadcastAndSaveNotificationContracts } from './transactionServiceBroadcast.broadcastAndSave.notifications.contracts';
import { setupBroadcastAndSaveDefaults } from './transactionServiceBroadcast.broadcastAndSave.shared';

export const registerBroadcastAndSaveTests = () => {
  describe('broadcastAndSave', () => {
    beforeEach(setupBroadcastAndSaveDefaults);

    registerBroadcastAndSaveCoreContracts();
    registerBroadcastAndSaveNotificationContracts();
    registerBroadcastAndSaveFailureAndRbfContracts();
  });
};
