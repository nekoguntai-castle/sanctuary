/**
 * Shared Utilities for Advanced Transactions
 *
 * Common imports, configuration constants, and helper functions
 * used across RBF, CPFP, batch, and fee estimation modules.
 */

import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { safeJsonParse, SystemSettingSchemas } from '../../../utils/safeJson';
import { DEFAULT_DUST_THRESHOLD } from '../../../constants';

export const log = createLogger('ADVANCED_TX');

/**
 * RBF (Replace-By-Fee) Configuration
 */
export const RBF_SEQUENCE = 0xfffffffd; // Signals RBF is enabled
export const MAX_RBF_SEQUENCE = 0xfffffffe;
export const MIN_RBF_FEE_BUMP = 1; // Minimum 1 sat/vB increase

/**
 * CPFP (Child-Pays-For-Parent) Configuration
 */
export const CPFP_MIN_FEE_RATE = 1;

/**
 * Get dust threshold from system settings
 */
export async function getDustThreshold(): Promise<number> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'dustThreshold' },
  });
  return safeJsonParse(setting?.value, SystemSettingSchemas.number, DEFAULT_DUST_THRESHOLD, 'dustThreshold');
}
