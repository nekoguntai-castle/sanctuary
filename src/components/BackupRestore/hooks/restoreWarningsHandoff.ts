/**
 * Restore warnings hand-off
 *
 * A successful restore invalidates every session, so the warnings it returns
 * would be wiped by the terminal logout that follows. They are kept in a
 * tab-scoped sessionStorage entry and shown again after the next admin login.
 */

import type { CreateNotificationInput } from '../../../contexts/AppNotificationContext';
import { createLogger } from '../../../utils/logger';
import { safeJsonParse } from '../../../utils/safeJson';

const log = createLogger('RestoreWarningsHandoff');

export const RESTORE_WARNINGS_HANDOFF_KEY = 'sanctuary_restore_warnings_handoff';
export const RESTORE_WARNINGS_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

export interface RestoreWarningsHandoff {
  id: string;
  createdAt: number;
  warnings: string[];
}

export function stashRestoreWarnings(warnings: readonly string[], now = Date.now()): RestoreWarningsHandoff {
  const handoff: RestoreWarningsHandoff = {
    id: `${now}-${Math.random().toString(36).slice(2)}`,
    createdAt: now,
    warnings: [...warnings],
  };
  try {
    sessionStorage.setItem(RESTORE_WARNINGS_HANDOFF_KEY, JSON.stringify(handoff));
  } catch (error) {
    log.debug('Could not stash restore warnings', { error });
  }
  return handoff;
}

function readAndRemoveHandoff(): string | null {
  try {
    const raw = sessionStorage.getItem(RESTORE_WARNINGS_HANDOFF_KEY);
    sessionStorage.removeItem(RESTORE_WARNINGS_HANDOFF_KEY);
    return raw;
  } catch (error) {
    log.debug('Could not read restore warnings hand-off', { error });
    return null;
  }
}

function isValidHandoff(value: unknown, now: number): value is RestoreWarningsHandoff {
  if (typeof value !== 'object' || value === null) return false;
  const { id, createdAt, warnings } = value as Partial<Record<keyof RestoreWarningsHandoff, unknown>>;
  if (typeof id !== 'string' || typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return false;
  const age = now - createdAt;
  if (age < 0 || age > RESTORE_WARNINGS_HANDOFF_TTL_MS) return false;
  return Array.isArray(warnings) && warnings.length > 0 && warnings.every((w) => typeof w === 'string');
}

export function takeRestoreWarnings(now = Date.now()): RestoreWarningsHandoff | null {
  const raw = readAndRemoveHandoff();
  if (raw === null) return null;
  const parsed = safeJsonParse(raw);
  if (!parsed.success || !isValidHandoff(parsed.data, now)) return null;
  return parsed.data;
}

export function restoreWarningNotification(
  handoff: RestoreWarningsHandoff,
  warning: string,
  index: number,
): CreateNotificationInput {
  return {
    type: 'warning',
    scope: 'global',
    scopeId: `restore:${handoff.id}:${index}`,
    severity: 'warning',
    title: 'Restore Warning',
    message: warning,
    persistent: true,
  };
}
