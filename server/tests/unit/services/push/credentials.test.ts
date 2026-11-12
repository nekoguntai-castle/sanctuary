import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushConfig = vi.hoisted(() => ({
  fcm: { serviceAccountPath: '' },
  apns: { keyId: '', teamId: '', keyPath: '', bundleId: '', isProduction: false },
}));
const mockAccessSync = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/config', () => ({
  getConfig: () => ({ push: pushConfig }),
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('fs', () => ({
  accessSync: mockAccessSync,
  constants: { R_OK: 4 },
}));

import {
  getApnsCredentials,
  getFcmServiceAccountPath,
  hasPushCredentials,
  isFcmServiceAccountReadable,
} from '../../../../src/services/push/credentials';

const apns = { keyId: 'key', teamId: 'team', keyPath: '/path', bundleId: 'bundle', isProduction: true };

describe('push credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushConfig.fcm.serviceAccountPath = '';
    Object.assign(pushConfig.apns, { keyId: '', teamId: '', keyPath: '', bundleId: '', isProduction: false });
    mockAccessSync.mockReturnValue(undefined);
  });

  it('returns the APNs credentials when all four values are set', () => {
    Object.assign(pushConfig.apns, apns);

    expect(getApnsCredentials()).toEqual(apns);
  });

  it.each(['keyId', 'teamId', 'keyPath', 'bundleId'] as const)(
    'returns no APNs credentials when %s is missing',
    (field) => {
      Object.assign(pushConfig.apns, apns, { [field]: '' });

      expect(getApnsCredentials()).toBeNull();
    },
  );

  it('returns the FCM service account path, or null when none is set', () => {
    expect(getFcmServiceAccountPath()).toBeNull();

    pushConfig.fcm.serviceAccountPath = '/path/to/file.json';
    expect(getFcmServiceAccountPath()).toBe('/path/to/file.json');
  });

  it('does not touch the filesystem when no FCM service account is set', () => {
    expect(isFcmServiceAccountReadable()).toBe(false);
    expect(mockAccessSync).not.toHaveBeenCalled();
  });

  it('reports an unreadable FCM service account as not configured', () => {
    pushConfig.fcm.serviceAccountPath = '/nonexistent/file.json';
    mockAccessSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(isFcmServiceAccountReadable()).toBe(false);
    expect(hasPushCredentials()).toBe(false);
  });

  it('re-reads the answer on every call instead of remembering the first one', () => {
    // The old isFCMConfigured() cached its first answer for the life of the
    // process, so a service account mounted after startup was never seen.
    pushConfig.fcm.serviceAccountPath = '/path/to/file.json';
    mockAccessSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    expect(hasPushCredentials()).toBe(false);
    expect(hasPushCredentials()).toBe(true);
  });

  it('has credentials with APNs alone, with FCM alone, and with neither', () => {
    expect(hasPushCredentials()).toBe(false);

    Object.assign(pushConfig.apns, apns);
    expect(hasPushCredentials()).toBe(true);
    expect(mockAccessSync).not.toHaveBeenCalled();

    Object.assign(pushConfig.apns, { keyId: '' });
    pushConfig.fcm.serviceAccountPath = '/path/to/file.json';
    expect(hasPushCredentials()).toBe(true);
  });
});
