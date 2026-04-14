import { beforeEach, describe } from 'vitest';
import { registerBroadcastAndSaveCoreContracts } from './transactionServiceBroadcast.broadcastAndSave.core.contracts';
import { registerBroadcastAndSaveFailureAndRbfContracts } from './transactionServiceBroadcast.broadcastAndSave.failures-rbf.contracts';
import { registerBroadcastAndSaveNotificationContracts } from './transactionServiceBroadcast.broadcastAndSave.notifications.contracts';
import { registerBroadcastAndSavePsbtFallbackContracts } from './transactionServiceBroadcast.broadcastAndSave.psbt-fallback.contracts';
import { setupBroadcastAndSaveDefaults } from './transactionServiceBroadcast.broadcastAndSave.shared';

export const registerBroadcastAndSaveTests = () => {
  describe('broadcastAndSave', () => {
    beforeEach(setupBroadcastAndSaveDefaults);

    registerBroadcastAndSaveCoreContracts();
    registerBroadcastAndSavePsbtFallbackContracts();
    registerBroadcastAndSaveNotificationContracts();
    registerBroadcastAndSaveFailureAndRbfContracts();
  });
};
