/**
 * Push provider credentials.
 *
 * The one place that decides whether this process holds APNs or FCM
 * credentials. Everything reads the validated config module (`config.push`);
 * nothing reads the environment or remembers an earlier answer.
 */

import * as fs from 'fs';
import { getConfig } from '../../config';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';

const log = createLogger('PUSH:SVC_CREDENTIALS');

export interface ApnsCredentials {
  keyId: string;
  teamId: string;
  keyPath: string;
  bundleId: string;
  isProduction: boolean;
}

/** The APNs credentials, or null unless all four values are set. */
export function getApnsCredentials(): ApnsCredentials | null {
  const { apns } = getConfig().push;
  if (!apns.keyId || !apns.teamId || !apns.keyPath || !apns.bundleId) return null;
  return { ...apns };
}

/** The configured FCM service account path, or null when none is set. */
export function getFcmServiceAccountPath(): string | null {
  return getConfig().push.fcm.serviceAccountPath || null;
}

/** Whether an FCM service account is configured and its file is readable. */
export function isFcmServiceAccountReadable(): boolean {
  const serviceAccountPath = getFcmServiceAccountPath();
  if (!serviceAccountPath) return false;
  try {
    fs.accessSync(serviceAccountPath, fs.constants.R_OK);
    return true;
  } catch (error) {
    log.debug('FCM service account not accessible', { error: getErrorMessage(error) });
    return false;
  }
}

/** Whether this process holds credentials for at least one push provider. */
export function hasPushCredentials(): boolean {
  return getApnsCredentials() !== null || isFcmServiceAccountReadable();
}
