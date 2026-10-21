/**
 * Restore outcome classification
 *
 * A restore that times out or loses its connection may still be running on the
 * server (it does not observe the request abort), so the client cannot tell
 * whether the data was replaced. Such outcomes must never invite a second restore.
 */

import { ApiError } from '../../../api/client';

export const RESTORE_OUTCOME_UNKNOWN_MESSAGE =
  'The restore did not report back in time. The server may still be restoring and may already have replaced your data. ' +
  'Do not start another restore: wait a few minutes, reload this page and check your data first.';

/** True for a client abort/network failure (status 0) or a server request timeout (408). */
export function isRestoreOutcomeUnknown(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 408);
}
