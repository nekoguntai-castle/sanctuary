/**
 * Mobile Permissions Collector
 *
 * Reports how many mobile-permission rows exist and which capabilities are
 * enabled across them. Helps diagnose "the mobile app can't do X" tickets
 * without exposing individual wallet or user identifiers.
 */

import { mobilePermissionRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('mobilePermissions', async () => {
  try {
    const stats = await mobilePermissionRepository.getSupportStats();
    return stats as unknown as Record<string, unknown>;
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
