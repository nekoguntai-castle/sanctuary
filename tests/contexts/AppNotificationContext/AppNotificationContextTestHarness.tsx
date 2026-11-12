import { ReactNode } from 'react';
import { vi } from 'vitest';

import { AppNotificationProvider } from '../../../src/contexts/AppNotificationContext';
import { sessionOwner } from './sessionOwner';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// The provider reads the session owner from UserContext, which the test entry
// file mocks to read `sessionOwner`; contracts switch the owner through here.
export const setSessionUserId = (userId: string | null): void => {
  sessionOwner.userId = userId;
};

export const wrapper = ({ children }: { children: ReactNode }) => (
  <AppNotificationProvider>{children}</AppNotificationProvider>
);

export const setupAppNotificationContextTest = () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  sessionOwner.userId = 'user-1';
};

export const cleanupAppNotificationContextTest = () => {
  vi.useRealTimers();
};
