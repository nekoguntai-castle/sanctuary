import { ReactNode } from 'react';
import { vi } from 'vitest';

import { AppNotificationProvider } from '../../../contexts/AppNotificationContext';

vi.mock('../../../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

export const wrapper = ({ children }: { children: ReactNode }) => (
  <AppNotificationProvider>{children}</AppNotificationProvider>
);

export const setupAppNotificationContextTest = () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
};

export const cleanupAppNotificationContextTest = () => {
  vi.useRealTimers();
};
