/**
 * SMTP settings round-trip: the admin settings writer stores every value
 * JSON-encoded, so the email service must decode what it reads (and still
 * accept legacy raw rows).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store, mockTransporter, createTransport } = vi.hoisted(() => {
  const mockTransporter = { sendMail: vi.fn(), verify: vi.fn(), close: vi.fn() };
  return { store: new Map<string, string>(), mockTransporter, createTransport: vi.fn(() => mockTransporter) };
});

vi.mock('nodemailer', () => ({ default: { createTransport } }));

vi.mock('../../../../src/repositories', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/repositories/systemSettingRepository')>(
    '../../../../src/repositories/systemSettingRepository',
  );
  const { decodeStoredString } = await vi.importActual<typeof import('../../../../src/utils/safeJson')>(
    '../../../../src/utils/safeJson',
  );
  const rows = () => [...store].map(([key, value]) => ({ key, value }));
  const getValue = async (key: string) => store.get(key) ?? null;
  return {
    SystemSettingKeys: actual.SystemSettingKeys,
    systemSettingRepository: {
      getValue,
      getString: async (key: string) => {
        const v = await getValue(key);
        return v === null ? null : decodeStoredString(v);
      },
      // Same semantics as the real repository readers.
      getNumber: async (key: string, d = 0) => {
        const v = await getValue(key);
        if (v === null) return d;
        const n = Number(v);
        return isNaN(n) ? d : n;
      },
      getBoolean: async (key: string, d = false) => {
        const v = await getValue(key);
        return v === null ? d : v === 'true' || v === '1';
      },
      getAll: async () => rows(),
      updateAtomically: async (derive: (current: { key: string; value: string }[]) => { key: string; value: string }[]) => {
        for (const { key, value } of derive(rows())) store.set(key, value);
        return rows();
      },
    },
  };
});

import { updateAdminSettings } from '../../../../src/services/adminSettingsService';
import { clearTransporterCache, getSmtpConfig, isSmtpConfigured, sendEmail } from '../../../../src/services/email/emailService';
import { encrypt } from '../../../../src/utils/encryption';

describe('SMTP settings saved through the admin settings API', () => {
  beforeEach(() => {
    store.clear();
    clearTransporterCache();
    vi.clearAllMocks();
    mockTransporter.sendMail.mockResolvedValue({ messageId: 'm-1' });
  });

  it('reads back the plain values and decrypts the stored password', async () => {
    await updateAdminSettings({
      'smtp.host': 'smtp.example.com',
      'smtp.port': 465,
      'smtp.secure': true,
      'smtp.user': 'mailer',
      'smtp.password': 'p@ss:word',
      'smtp.fromAddress': 'noreply@example.com',
      'smtp.fromName': 'Ops Desk',
    });
    expect(store.get('smtp.host')).toBe('"smtp.example.com"');

    await expect(getSmtpConfig()).resolves.toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      user: 'mailer',
      password: 'p@ss:word',
      fromAddress: 'noreply@example.com',
      fromName: 'Ops Desk',
    });
  });

  it('sends with the decoded host, credentials and sender', async () => {
    await updateAdminSettings({
      'smtp.host': 'smtp.example.com',
      'smtp.user': 'mailer',
      'smtp.password': 'secret',
      'smtp.fromAddress': 'noreply@example.com',
      'smtp.fromName': 'Ops Desk',
    });

    await expect(sendEmail({ to: 'u@example.com', subject: 's', text: 't', html: '<p>t</p>' }))
      .resolves.toMatchObject({ success: true });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      auth: { user: 'mailer', pass: 'secret' },
    }));
    expect(mockTransporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: '"Ops Desk" <noreply@example.com>',
    }));
  });

  it('treats the empty values a backup restore writes as not configured', async () => {
    store.set('smtp.host', JSON.stringify(''));
    store.set('smtp.fromAddress', JSON.stringify(''));

    await expect(getSmtpConfig()).resolves.toBeNull();
    await expect(isSmtpConfigured()).resolves.toBe(false);
  });

  it('still reads legacy raw rows', async () => {
    store.set('smtp.host', 'smtp.legacy.example');
    store.set('smtp.user', 'legacy');
    store.set('smtp.password', encrypt('legacy-secret'));
    store.set('smtp.fromAddress', 'legacy@example.com');

    await expect(getSmtpConfig()).resolves.toMatchObject({
      host: 'smtp.legacy.example',
      user: 'legacy',
      password: 'legacy-secret',
      fromAddress: 'legacy@example.com',
      fromName: 'Sanctuary',
    });
  });
});
