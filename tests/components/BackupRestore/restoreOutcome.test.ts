import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../src/api/client';
import {
  isRestoreOutcomeUnknown,
  RESTORE_OUTCOME_UNKNOWN_MESSAGE,
} from '../../../src/components/BackupRestore/hooks/restoreOutcome';

describe('isRestoreOutcomeUnknown', () => {
  it('treats a client abort or network failure (status 0) as unknown', () => {
    expect(isRestoreOutcomeUnknown(new ApiError('signal timed out', 0))).toBe(true);
  });

  it('treats a server request timeout (408) as unknown', () => {
    expect(isRestoreOutcomeUnknown(new ApiError('Request timeout', 408))).toBe(true);
  });

  it('treats definite server answers as known failures', () => {
    expect(isRestoreOutcomeUnknown(new ApiError('Internal error', 500))).toBe(false);
    expect(isRestoreOutcomeUnknown(new ApiError('Bad request', 400))).toBe(false);
  });

  it('treats non-ApiError values as known failures', () => {
    expect(isRestoreOutcomeUnknown(new Error('boom'))).toBe(false);
    expect(isRestoreOutcomeUnknown(null)).toBe(false);
  });

  it('warns against starting another restore', () => {
    expect(RESTORE_OUTCOME_UNKNOWN_MESSAGE).toContain('Do not start another restore');
  });
});
