import { describe, expect, it, vi } from 'vitest';
import { AUDIT_FIXTURE_RECEIVE } from '../../../fixtures/walletSafetyAuditFixture';

const descriptorParser = vi.hoisted(() => ({
  extractDescriptorFromText: vi.fn(() => null),
}));
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/descriptorParser/descriptorParser', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/services/bitcoin/descriptorParser/descriptorParser')>(),
  extractDescriptorFromText: descriptorParser.extractDescriptorFromText,
}));
vi.mock('../../../../src/utils/logger', () => ({ createLogger: () => logger }));

import { parseImportInput } from '../../../../src/services/bitcoin/descriptorParser/parseImportInput';

describe('descriptor text detector/extractor drift', () => {
  it('fails closed and records only metadata if extraction unexpectedly returns null', () => {
    const input = `# Sparrow export\n${AUDIT_FIXTURE_RECEIVE}`;

    expect(() => parseImportInput(input)).toThrow();
    expect(logger.debug).toHaveBeenCalledWith('Extracted descriptor from text', {
      descriptorFound: false,
      descriptorLength: 0,
    });
  });
});
