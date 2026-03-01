/**
 * Wallet Import - Device Resolution
 *
 * Handles fingerprint matching, conflict detection, and device
 * resolution against existing user devices during wallet import.
 */

import { db as prisma } from '../../repositories/db';
import type { ParsedDevice, JsonImportDevice } from '../bitcoin/descriptorParser';
import type { DeviceResolution } from './types';

/**
 * Generate a unique device label that doesn't conflict with existing labels
 */
export function generateUniqueLabel(
  baseLabel: string,
  existingLabels: Set<string>
): string {
  // If the base label is unique, use it
  if (!existingLabels.has(baseLabel.toLowerCase())) {
    return baseLabel;
  }

  // Otherwise, append a number to make it unique
  let counter = 2;
  let newLabel = `${baseLabel} (${counter})`;
  while (existingLabels.has(newLabel.toLowerCase())) {
    counter++;
    newLabel = `${baseLabel} (${counter})`;
  }
  return newLabel;
}

/**
 * Resolve devices from parsed import data against existing user devices
 */
export async function resolveDevices(
  userId: string,
  parsedDevices: ParsedDevice[],
  originalDevices?: JsonImportDevice[]
): Promise<DeviceResolution[]> {
  // Fetch all user's existing devices
  const existingDevices = await prisma.device.findMany({
    where: { userId },
    select: {
      id: true,
      fingerprint: true,
      label: true,
      xpub: true,
    },
  });

  // Create maps for quick lookup
  const deviceByFingerprint = new Map(
    existingDevices.map((d) => [d.fingerprint.toLowerCase(), d])
  );

  // Track all existing labels (case-insensitive)
  const existingLabels = new Set(
    existingDevices.map((d) => d.label.toLowerCase())
  );

  // Track labels we're assigning in this batch to avoid duplicates within the import
  const assignedLabels = new Set<string>();

  // Resolve each device
  return parsedDevices.map((device, index) => {
    const existing = deviceByFingerprint.get(device.fingerprint.toLowerCase());
    const originalDevice = originalDevices?.[index];

    const resolution: DeviceResolution = {
      fingerprint: device.fingerprint,
      xpub: device.xpub,
      derivationPath: device.derivationPath,
      existingDeviceId: existing?.id || null,
      existingDeviceLabel: existing?.label || null,
      willCreate: !existing,
    };

    if (!existing) {
      // Generate unique suggested label for new device
      const baseLabel = originalDevice?.label || `Imported Device ${index + 1}`;

      // Combine existing labels and already assigned labels for uniqueness check
      const allUsedLabels = new Set([...existingLabels, ...assignedLabels]);
      const uniqueLabel = generateUniqueLabel(baseLabel, allUsedLabels);

      resolution.suggestedLabel = uniqueLabel;
      resolution.originalType = originalDevice?.type || 'unknown';

      // Track this label as assigned
      assignedLabels.add(uniqueLabel.toLowerCase());
    }

    return resolution;
  });
}

/**
 * Check for duplicate wallet by comparing device fingerprints
 * against existing user wallets. Throws if a duplicate is found.
 */
export async function checkDuplicateWallet(
  userId: string,
  newFingerprints: Set<string>
): Promise<void> {
  const userWallets = await prisma.wallet.findMany({
    where: {
      users: { some: { userId } },
      descriptor: { not: null },
    },
    select: {
      id: true,
      name: true,
      descriptor: true,
    },
  });

  for (const wallet of userWallets) {
    if (!wallet.descriptor) continue;

    // Extract fingerprints from existing wallet descriptor
    const existingFingerprints = new Set(
      (wallet.descriptor.match(/\[([a-f0-9]{8})\//gi) || [])
        .map(m => m.slice(1, 9).toLowerCase())
    );

    // Check if same set of devices
    if (existingFingerprints.size === newFingerprints.size &&
        [...newFingerprints].every(fp => existingFingerprints.has(fp))) {
      throw new Error(`A wallet with these devices already exists: "${wallet.name}"`);
    }
  }
}
