import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  findByKeys: vi.fn(),
  set: vi.fn(),
  encrypt: vi.fn((value: string) => `enc:${value}`),
  isEncrypted: vi.fn((value: string) => value.startsWith('enc:')),
  clearTransporterCache: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  systemSettingRepository: {
    getAll: mocks.getAll,
    findByKeys: mocks.findByKeys,
    set: mocks.set,
  },
}));

vi.mock('../../../src/utils/encryption', () => ({
  encrypt: mocks.encrypt,
  isEncrypted: mocks.isEncrypted,
}));

vi.mock('../../../src/services/email', () => ({
  clearTransporterCache: mocks.clearTransporterCache,
}));

const loadService = async () => {
  vi.resetModules();
  return import('../../../src/services/adminSettingsService');
};

describe('adminSettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.encrypt.mockImplementation((value: string) => `enc:${value}`);
    mocks.isEncrypted.mockImplementation((value: string) => value.startsWith('enc:'));
    mocks.findByKeys.mockResolvedValue([]);
    mocks.set.mockResolvedValue(undefined);
  });

  it('builds admin settings with defaults, stored values, and SMTP password redaction', async () => {
    const { buildAdminSettingsResponse } = await loadService();

    const response = buildAdminSettingsResponse([
      { key: 'registrationEnabled', value: 'true' },
      { key: 'smtp.host', value: '"smtp.example.com"' },
      { key: 'smtp.fromAddress', value: '"noreply@example.com"' },
      { key: 'smtp.password', value: '"secret"' },
    ]);

    expect(response.registrationEnabled).toBe(true);
    expect(response.confirmationThreshold).toBeDefined();
    expect(response['smtp.configured']).toBe(true);
    expect(response['smtp.password']).toBeUndefined();
  });

  it('encrypts plaintext SMTP passwords, clears email transport cache, and returns sanitized settings', async () => {
    mocks.getAll.mockResolvedValueOnce([
      { key: 'smtp.host', value: '"smtp.example.com"' },
      { key: 'smtp.fromAddress', value: '"noreply@example.com"' },
      { key: 'smtp.password', value: '"enc:new-secret"' },
    ]);
    const { updateAdminSettings } = await loadService();

    const response = await updateAdminSettings({
      'smtp.host': 'smtp.example.com',
      'smtp.fromAddress': 'noreply@example.com',
      'smtp.password': 'new-secret',
    });

    expect(mocks.isEncrypted).toHaveBeenCalledWith('new-secret');
    expect(mocks.encrypt).toHaveBeenCalledWith('new-secret');
    expect(mocks.set).toHaveBeenCalledWith('smtp.password', JSON.stringify('enc:new-secret'));
    expect(mocks.clearTransporterCache).toHaveBeenCalledTimes(1);
    expect(response['smtp.configured']).toBe(true);
    expect(response['smtp.password']).toBeUndefined();
  });

  it('rejects deep confirmation thresholds lower than confirmation thresholds', async () => {
    mocks.findByKeys.mockResolvedValueOnce([
      { key: 'confirmationThreshold', value: '3' },
      { key: 'deepConfirmationThreshold', value: '6' },
    ]);
    const { updateAdminSettings } = await loadService();

    await expect(updateAdminSettings({
      confirmationThreshold: 6,
      deepConfirmationThreshold: 2,
    })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Deep confirmation threshold must be greater than or equal to confirmation threshold',
    });

    expect(mocks.set).not.toHaveBeenCalled();
  });
});
