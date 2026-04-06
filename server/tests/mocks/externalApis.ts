import { vi, Mock } from 'vitest';
/**
 * External API Mocks
 *
 * Mocks for external services like Telegram API and Firebase Cloud Messaging.
 */

// Mock fetch for Telegram API
export const mockTelegramResponse = {
  ok: true,
  result: {
    message_id: 12345,
  },
};

export const mockTelegramUpdates = {
  ok: true,
  result: [
    {
      update_id: 123456789,
      message: {
        message_id: 1,
        chat: {
          id: 987654321,
          type: 'private',
          username: 'testuser',
          first_name: 'Test',
        },
        text: '/start',
      },
    },
  ],
};

// Create Telegram API mock
export function createTelegramApiMock(): Mock {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/sendMessage')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTelegramResponse),
      });
    }
    if (url.includes('/getUpdates')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTelegramUpdates),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ ok: false, description: 'Not found' }),
    });
  });
}

// Mock FCM (Firebase Cloud Messaging) for push notifications
export const mockFCMResponse = {
  successCount: 1,
  failureCount: 0,
  responses: [{ success: true }],
};

export const mockFCMClient = {
  sendMulticast: vi.fn().mockResolvedValue(mockFCMResponse),
  send: vi.fn().mockResolvedValue('message-id'),
  subscribeToTopic: vi.fn().mockResolvedValue({ successCount: 1, errors: [] }),
  unsubscribeFromTopic: vi.fn().mockResolvedValue({ successCount: 1, errors: [] }),
};

// Helper to setup global fetch mock for Telegram
export function setupTelegramMock(): void {
  const telegramMock = createTelegramApiMock();
  global.fetch = telegramMock as unknown as typeof fetch;
}

// Helper to create failed Telegram response
export function createTelegramErrorMock(errorMessage: string): Mock {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: () => Promise.resolve({
      ok: false,
      description: errorMessage,
    }),
  });
}

// Helper to reset all external API mocks
export function resetExternalApiMocks(): void {
  Object.values(mockFCMClient).forEach((method) => {
    if (typeof method === 'function' && 'mockClear' in method) {
      (method as Mock).mockClear();
    }
  });
}

export default {
  createTelegramApiMock,
  createTelegramErrorMock,
  setupTelegramMock,
  mockFCMClient,
  mockFCMResponse,
  resetExternalApiMocks,
};
