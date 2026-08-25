import { describe, expect, it } from 'vitest';

import { isInvalidCsrfTokenError } from '../../../src/middleware/csrfError';

function csrfError(statusField: 'status' | 'statusCode'): Error {
  return Object.assign(new Error('invalid csrf token'), {
    code: 'EBADCSRFTOKEN',
    [statusField]: 403,
  });
}

describe('isInvalidCsrfTokenError', () => {
  it('accepts both supported HTTP error status fields', () => {
    expect(isInvalidCsrfTokenError(csrfError('status'))).toBe(true);
    expect(isInvalidCsrfTokenError(csrfError('statusCode'))).toBe(true);
  });

  it.each([
    null,
    { code: 'EBADCSRFTOKEN', statusCode: 403 },
    Object.assign(new Error('different'), { code: 'EBADCSRFTOKEN', statusCode: 403 }),
    Object.assign(new Error('invalid csrf token'), { code: 'OTHER', statusCode: 403 }),
    Object.assign(new Error('invalid csrf token'), { code: 'EBADCSRFTOKEN', statusCode: 400 }),
  ])('rejects a near-miss error contract', (error) => {
    expect(isInvalidCsrfTokenError(error)).toBe(false);
  });
});
