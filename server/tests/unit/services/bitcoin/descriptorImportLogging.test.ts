import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_FIXTURE_RECEIVE,
  AUDIT_FIXTURE_XPUB,
} from '../../../fixtures/walletSafetyAuditFixture';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import { parseImportInput } from '../../../../src/services/bitcoin/descriptorParser/parseImportInput';

describe('descriptor import logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs format metadata without descriptor recovery material', () => {
    expect(parseImportInput(AUDIT_FIXTURE_RECEIVE).format).toBe('descriptor');
    expect(parseImportInput(`# Sparrow export\n${AUDIT_FIXTURE_RECEIVE}`).format).toBe('descriptor');

    const capturedLogs = JSON.stringify(mockLogger.debug.mock.calls);
    expect(capturedLogs).not.toContain(AUDIT_FIXTURE_RECEIVE);
    expect(capturedLogs).not.toContain(AUDIT_FIXTURE_XPUB);
    expect(capturedLogs).not.toContain('aabbccdd');
    expect(capturedLogs).not.toContain("84'/1'/0'");
    expect(capturedLogs).toContain('inputLength');
  });
});
