/**
 * Push Notification Collector
 *
 * Collects push notification provider health and device registration counts.
 * Rounds out the notification diagnostic story alongside the Telegram collector.
 */

import { getPushService } from '../../push/pushService';
import { db as prisma } from '../../../repositories/db';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('push', async () => {
  try {
    const pushService = getPushService();
    const health = await pushService.healthCheck();

    // Get device registration counts by platform (no PII)
    const deviceCounts = await prisma.pushDevice.groupBy({
      by: ['platform'],
      _count: { _all: true },
    });

    const devices: Record<string, number> = {};
    for (const group of deviceCounts) {
      devices[group.platform] = group._count._all;
    }

    return {
      health,
      devices,
      totalDevices: Object.values(devices).reduce((a, b) => a + b, 0),
    };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
