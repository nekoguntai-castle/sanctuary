/**
 * AppNotificationContext Tests
 *
 * Tests for the app notification context including scoped notifications,
 * localStorage persistence, and CRUD operations.
 */

import { afterEach, beforeEach, describe } from 'vitest';

import { registerAppNotificationLifecycleCrudContracts } from './AppNotificationContext/AppNotificationContext.lifecycle-crud.contracts';
import { registerAppNotificationPersistenceExpirationContracts } from './AppNotificationContext/AppNotificationContext.persistence-expiration.contracts';
import { registerAppNotificationScopedHookContracts } from './AppNotificationContext/AppNotificationContext.scoped-hooks.contracts';
import { registerAppNotificationSelectorsPanelContracts } from './AppNotificationContext/AppNotificationContext.selectors-panel.contracts';
import {
  cleanupAppNotificationContextTest,
  setupAppNotificationContextTest,
} from './AppNotificationContext/AppNotificationContextTestHarness';

describe('AppNotificationContext', () => {
  beforeEach(setupAppNotificationContextTest);
  afterEach(cleanupAppNotificationContextTest);

  registerAppNotificationLifecycleCrudContracts();
  registerAppNotificationSelectorsPanelContracts();
  registerAppNotificationPersistenceExpirationContracts();
});

registerAppNotificationScopedHookContracts();
