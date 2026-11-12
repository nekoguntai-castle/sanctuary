/**
 * AppNotificationContext Tests
 *
 * Tests for the app notification context including scoped notifications,
 * localStorage persistence, and CRUD operations.
 */

import { afterEach, beforeEach, describe, vi } from 'vitest';

// The provider is rendered standalone here, so the session owner it reads from
// UserContext is supplied by the harness (see sessionOwner.ts).
vi.mock('../../src/contexts/UserContext', async () => {
  const { sessionOwner } = await import('./AppNotificationContext/sessionOwner');
  return { useOptionalUserId: () => sessionOwner.userId };
});

import { registerAppNotificationLifecycleCrudContracts } from './AppNotificationContext/AppNotificationContext.lifecycle-crud.contracts';
import { registerAppNotificationPersistenceExpirationContracts } from './AppNotificationContext/AppNotificationContext.persistence-expiration.contracts';
import { registerAppNotificationTerminalLogoutContracts } from './AppNotificationContext/AppNotificationContext.terminal-logout.contracts';
import { registerAppNotificationSessionOwnerContracts } from './AppNotificationContext/AppNotificationContext.session-owner.contracts';
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
  registerAppNotificationTerminalLogoutContracts();
  registerAppNotificationSessionOwnerContracts();
});

registerAppNotificationScopedHookContracts();
