import { vi, type Mock } from 'vitest';
/**
 * Repository Mocks
 *
 * Provides mock implementations for all repositories.
 * Use these when testing services that depend on repositories.
 */

import type { AuditCategory } from '../../src/repositories/auditLogRepository';
import type { PushDevice } from '../../src/generated/prisma/client';
import type { CreatePushDeviceInput } from '../../src/repositories/pushDeviceRepository';

// =============================================================================
// Audit Log Repository Mock
// =============================================================================

export interface MockAuditLogEntry {
  id: string;
  userId: string | null;
  username: string;
  action: string;
  category: AuditCategory;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorMsg: string | null;
  createdAt: Date;
}

const mockAuditLogs: MockAuditLogEntry[] = [];

export const mockAuditLogRepository = {
  create: vi.fn().mockImplementation(async (input) => {
    const entry: MockAuditLogEntry = {
      id: `audit-${Date.now()}`,
      userId: input.userId || null,
      username: input.username,
      action: input.action,
      category: input.category,
      details: input.details || null,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null,
      success: input.success,
      errorMsg: input.errorMsg || null,
      createdAt: new Date(),
    };
    mockAuditLogs.push(entry);
    return entry;
  }),

  findMany: vi.fn().mockImplementation(async (filters) => {
    return mockAuditLogs.filter((log) => {
      if (filters?.category && log.category !== filters.category) return false;
      if (filters?.userId && log.userId !== filters.userId) return false;
      if (filters?.action && !log.action.includes(filters.action)) return false;
      if (filters?.success !== undefined && log.success !== filters.success) return false;
      return true;
    });
  }),

  findForUser: vi.fn().mockImplementation(async (userId, options) => {
    const filtered = mockAuditLogs.filter((log) => log.userId === userId);
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    return filtered.slice(offset, offset + limit);
  }),

  getFailedLogins: vi.fn().mockImplementation(async (userId) => {
    return mockAuditLogs.filter(
      (log) => log.userId === userId && log.action === 'auth.login' && !log.success
    );
  }),

  getAdminActions: vi.fn().mockImplementation(async (options) => {
    const filtered = mockAuditLogs.filter((log) => log.category === 'admin');
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    return filtered.slice(offset, offset + limit);
  }),

  deleteOlderThan: vi.fn().mockImplementation(async (date) => {
    const initialLength = mockAuditLogs.length;
    const remaining = mockAuditLogs.filter((log) => log.createdAt > date);
    mockAuditLogs.length = 0;
    mockAuditLogs.push(...remaining);
    return initialLength - remaining.length;
  }),

  getStats: vi.fn().mockImplementation(async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recent = mockAuditLogs.filter((log) => log.createdAt > yesterday);

    return {
      total: mockAuditLogs.length,
      last24Hours: recent.length,
      failedLogins: mockAuditLogs.filter(
        (log) => log.action === 'auth.login' && !log.success
      ).length,
      byCategory: {} as Record<string, number>,
    };
  }),
};

// =============================================================================
// Session Repository Mock
// =============================================================================

export interface MockSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  deviceId: string | null;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: Date;
  createdAt: Date;
}

const mockSessions: MockSession[] = [];

function defaultSessionId(): string {
  return `session-${Date.now()}-${Math.random()}`;
}

function defaultTokenHash(): string {
  return `hash-${Date.now()}`;
}

function defaultExpiresAt(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function defaultNow(): Date {
  return new Date();
}

function valueOrDefault<T>(value: T | null | undefined, getDefault: () => T): T {
  return value || getDefault();
}

function nullableField<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function buildMockSession(session: Partial<MockSession>): MockSession {
  return {
    id: valueOrDefault(session.id, defaultSessionId),
    userId: valueOrDefault(session.userId, () => 'test-user-id'),
    tokenHash: valueOrDefault(session.tokenHash, defaultTokenHash),
    expiresAt: valueOrDefault(session.expiresAt, defaultExpiresAt),
    deviceId: nullableField(session.deviceId),
    deviceName: nullableField(session.deviceName),
    userAgent: nullableField(session.userAgent),
    ipAddress: nullableField(session.ipAddress),
    lastUsedAt: valueOrDefault(session.lastUsedAt, defaultNow),
    createdAt: valueOrDefault(session.createdAt, defaultNow),
  };
}

export const mockSessionRepository = {
  createRefreshToken: vi.fn().mockImplementation(async (input) => {
    const session: MockSession = {
      id: `session-${Date.now()}`,
      userId: input.userId,
      tokenHash: `hash-${input.token.substring(0, 10)}`,
      expiresAt: input.expiresAt,
      deviceId: input.deviceId || null,
      deviceName: input.deviceName || null,
      userAgent: input.userAgent || null,
      ipAddress: input.ipAddress || null,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };
    mockSessions.push(session);
    return session;
  }),

  findRefreshToken: vi.fn().mockImplementation(async (token) => {
    return mockSessions.find((s) => s.tokenHash.includes(token.substring(0, 10))) || null;
  }),

  updateLastUsed: vi.fn().mockImplementation(async (sessionId) => {
    const session = mockSessions.find((s) => s.id === sessionId);
    if (session) {
      session.lastUsedAt = new Date();
    }
    return session || null;
  }),

  deleteSession: vi.fn().mockImplementation(async (sessionId) => {
    const index = mockSessions.findIndex((s) => s.id === sessionId);
    if (index >= 0) {
      mockSessions.splice(index, 1);
      return true;
    }
    return false;
  }),

  deleteByTokenHash: vi.fn().mockImplementation(async (tokenHash) => {
    const index = mockSessions.findIndex((s) => s.tokenHash === tokenHash);
    if (index >= 0) {
      mockSessions.splice(index, 1);
      return true;
    }
    return false;
  }),

  deleteAllForUser: vi.fn().mockImplementation(async (userId) => {
    const initialLength = mockSessions.length;
    const remaining = mockSessions.filter((s) => s.userId !== userId);
    mockSessions.length = 0;
    mockSessions.push(...remaining);
    return initialLength - remaining.length;
  }),

  findByUserId: vi.fn().mockImplementation(async (userId) => {
    return mockSessions.filter((s) => s.userId === userId);
  }),

  countActiveForUser: vi.fn().mockImplementation(async (userId) => {
    return mockSessions.filter(
      (s) => s.userId === userId && s.expiresAt > new Date()
    ).length;
  }),

  deleteExpired: vi.fn().mockImplementation(async () => {
    const now = new Date();
    const initialLength = mockSessions.length;
    const remaining = mockSessions.filter((s) => s.expiresAt > now);
    mockSessions.length = 0;
    mockSessions.push(...remaining);
    return initialLength - remaining.length;
  }),
};

// =============================================================================
// Push Device Repository Mock
// =============================================================================

const mockPushDevices: PushDevice[] = [];

export const mockPushDeviceRepository = {
  upsert: vi.fn().mockImplementation(async (input: CreatePushDeviceInput) => {
    const existing = mockPushDevices.find((d) => d.token === input.token);
    if (existing) {
      existing.lastUsedAt = new Date();
      existing.deviceName = input.deviceName || existing.deviceName;
      return existing;
    }

    const device: PushDevice = {
      id: `push-device-${Date.now()}`,
      userId: input.userId,
      token: input.token,
      platform: input.platform,
      deviceName: input.deviceName || null,
      appVersion: null,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };
    mockPushDevices.push(device);
    return device;
  }),

  findByToken: vi.fn().mockImplementation(async (token) => {
    return mockPushDevices.find((d) => d.token === token) || null;
  }),

  findById: vi.fn().mockImplementation(async (id) => {
    return mockPushDevices.find((d) => d.id === id) || null;
  }),

  findByUserId: vi.fn().mockImplementation(async (userId) => {
    return mockPushDevices.filter((d) => d.userId === userId);
  }),

  deleteByToken: vi.fn().mockImplementation(async (token) => {
    const index = mockPushDevices.findIndex((d) => d.token === token);
    if (index >= 0) {
      mockPushDevices.splice(index, 1);
      return true;
    }
    return false;
  }),

  deleteById: vi.fn().mockImplementation(async (id) => {
    const index = mockPushDevices.findIndex((d) => d.id === id);
    if (index >= 0) {
      mockPushDevices.splice(index, 1);
      return true;
    }
    return false;
  }),

  deleteAllForUser: vi.fn().mockImplementation(async (userId) => {
    const initialLength = mockPushDevices.length;
    const remaining = mockPushDevices.filter((d) => d.userId !== userId);
    mockPushDevices.length = 0;
    mockPushDevices.push(...remaining);
    return initialLength - remaining.length;
  }),
};

// =============================================================================
// System Setting Repository Mock
// =============================================================================

const mockSystemSettings: Map<string, unknown> = new Map();

export const mockSystemSettingRepository = {
  get: vi.fn().mockImplementation(async (key) => {
    return mockSystemSettings.get(key) ?? null;
  }),

  set: vi.fn().mockImplementation(async (key, value) => {
    mockSystemSettings.set(key, value);
  }),

  getMany: vi.fn().mockImplementation(async (keys) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const value = mockSystemSettings.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }),

  setMany: vi.fn().mockImplementation(async (settings) => {
    for (const [key, value] of Object.entries(settings)) {
      mockSystemSettings.set(key, value);
    }
  }),

  delete: vi.fn().mockImplementation(async (key) => {
    return mockSystemSettings.delete(key);
  }),

  getAll: vi.fn().mockImplementation(async () => {
    return Object.fromEntries(mockSystemSettings);
  }),
};

// =============================================================================
// Device Repository Mock
// =============================================================================

export interface MockDevice {
  id: string;
  type: string;
  label: string;
  fingerprint: string;
  xpub: string;
  derivationPath: string | null;
  modelSlug: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const mockDevices: MockDevice[] = [];

export const mockDeviceRepository = {
  create: vi.fn().mockImplementation(async (input) => {
    const device: MockDevice = {
      id: `device-${Date.now()}`,
      type: input.type,
      label: input.label,
      fingerprint: input.fingerprint,
      xpub: input.xpub,
      derivationPath: input.derivationPath || null,
      modelSlug: input.modelSlug || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDevices.push(device);
    return device;
  }),

  findById: vi.fn().mockImplementation(async (id) => {
    return mockDevices.find((d) => d.id === id) || null;
  }),

  findByFingerprint: vi.fn().mockImplementation(async (fingerprint) => {
    return mockDevices.find((d) => d.fingerprint === fingerprint) || null;
  }),

  findByUserId: vi.fn().mockImplementation(async (userId) => {
    // In real implementation, this would join with DeviceUser
    return mockDevices;
  }),

  update: vi.fn().mockImplementation(async (id, input) => {
    const device = mockDevices.find((d) => d.id === id);
    if (device) {
      Object.assign(device, input, { updatedAt: new Date() });
      return device;
    }
    return null;
  }),

  delete: vi.fn().mockImplementation(async (id) => {
    const index = mockDevices.findIndex((d) => d.id === id);
    if (index >= 0) {
      mockDevices.splice(index, 1);
      return true;
    }
    return false;
  }),
};

// =============================================================================
// Reset Functions
// =============================================================================

/**
 * Reset all repository mocks and clear stored data
 */
export function resetRepositoryMocks(): void {
  // Clear mock data
  mockAuditLogs.length = 0;
  mockSessions.length = 0;
  mockPushDevices.length = 0;
  mockSystemSettings.clear();
  mockDevices.length = 0;

  // Reset all mock functions
  Object.values(mockAuditLogRepository).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      (fn as Mock).mockClear();
    }
  });

  Object.values(mockSessionRepository).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      (fn as Mock).mockClear();
    }
  });

  Object.values(mockPushDeviceRepository).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      (fn as Mock).mockClear();
    }
  });

  Object.values(mockSystemSettingRepository).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      (fn as Mock).mockClear();
    }
  });

  Object.values(mockDeviceRepository).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      (fn as Mock).mockClear();
    }
  });
}

/**
 * Seed audit logs with test data
 */
export function seedAuditLogs(logs: Partial<MockAuditLogEntry>[]): void {
  for (const log of logs) {
    mockAuditLogs.push({
      id: log.id || `audit-${Date.now()}-${Math.random()}`,
      userId: log.userId ?? null,
      username: log.username || 'testuser',
      action: log.action || 'test.action',
      category: log.category || 'system',
      details: log.details || null,
      ipAddress: log.ipAddress || null,
      userAgent: log.userAgent || null,
      success: log.success ?? true,
      errorMsg: log.errorMsg || null,
      createdAt: log.createdAt || new Date(),
    });
  }
}

/**
 * Seed sessions with test data
 */
export function seedSessions(sessions: Partial<MockSession>[]): void {
  for (const session of sessions) {
    mockSessions.push(buildMockSession(session));
  }
}

export default {
  mockAuditLogRepository,
  mockSessionRepository,
  mockPushDeviceRepository,
  mockSystemSettingRepository,
  mockDeviceRepository,
  resetRepositoryMocks,
  seedAuditLogs,
  seedSessions,
};
