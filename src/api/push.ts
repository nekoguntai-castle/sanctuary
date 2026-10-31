/**
 * Push API
 *
 * The web client only reads the user's registered mobile push devices. Devices
 * are registered and unregistered by the Sanctuary mobile app; the server
 * delivers pushes to them through the gateway.
 */

import { z } from 'zod';
import apiClient from './client';

const PushDeviceSchema = z.object({
  id: z.string(),
  platform: z.enum(['ios', 'android']),
  deviceName: z.string().nullable().optional(),
  lastUsedAt: z.string(),
  createdAt: z.string(),
});

export const PushDevicesResponseSchema = z.object({
  devices: z.array(PushDeviceSchema),
});

export type PushDevice = z.infer<typeof PushDeviceSchema>;
type PushDevicesResponse = z.infer<typeof PushDevicesResponseSchema>;

/**
 * List the push devices registered by the current user.
 */
export async function getPushDevices(): Promise<PushDevice[]> {
  const response = await apiClient.get<PushDevicesResponse>(
    '/push/devices',
    undefined,
    undefined,
    { schema: PushDevicesResponseSchema },
  );
  return response.devices;
}
