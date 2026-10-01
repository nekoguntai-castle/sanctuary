/**
 * Wallet Import - Device Resolution
 *
 * Handles fingerprint matching, conflict detection, and device
 * resolution against existing user devices during wallet import.
 */

import { ConflictError } from '../../errors/ApiError';
import { deviceRepository, walletRepository } from '../../repositories';
import type { ParsedDevice, JsonImportDevice, ScriptType } from '../bitcoin/descriptorParser';
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
  const existingDevices = await deviceRepository.findByUserIdWithModel(userId);

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
      existingType: existing?.type,
      existingModel: existing?.model,
      originalType: originalDevice?.type,
    };

    if (!existing) {
      // Generate unique suggested label for new device
      const baseLabel = originalDevice?.label || `Imported Device ${index + 1}`;

      // Combine existing labels and already assigned labels for uniqueness check
      const allUsedLabels = new Set([...existingLabels, ...assignedLabels]);
      const uniqueLabel = generateUniqueLabel(baseLabel, allUsedLabels);

      resolution.suggestedLabel = uniqueLabel;
      // Descriptor-only imports are watch-only unless the source carries
      // explicit hardware provenance. Do not invent a generic hardware signer.
      resolution.originalType = originalDevice?.type || 'watch_only';

      // Track this label as assigned
      assignedLabels.add(uniqueLabel.toLowerCase());
    }

    return resolution;
  });
}

/** Key origin `fingerprint/path`, lowercased with hardened steps written as `'`. */
function keyOrigin(fingerprint: string, derivationPath: string): string {
  const steps = derivationPath.replace(/^m\/?/i, '').replace(/^\//, '');
  return `${fingerprint.toLowerCase()}/${steps.replace(/[hH]/g, "'")}`;
}

/** Key origins (`[fingerprint/path]`) of a stored descriptor. */
function descriptorKeyOrigins(descriptor: string): Set<string> {
  return new Set(
    [...descriptor.matchAll(/\[([a-f0-9]{8})((?:\/\d+['hH]?)+)\]/gi)]
      .map(([, fingerprint, path]) => keyOrigin(fingerprint, path))
  );
}

/**
 * Check for a duplicate wallet: an accessible wallet with the same script type
 * and the same set of key origins (device fingerprint + derivation path).
 * One signer may back several script types and several accounts, so only an
 * exact match is a duplicate. Throws ConflictError (409) if found.
 */
export async function checkDuplicateWallet(
  userId: string,
  devices: ReadonlyArray<Pick<ParsedDevice, 'fingerprint' | 'derivationPath'>>,
  scriptType: ScriptType
): Promise<void> {
  const newOrigins = new Set(devices.map(d => keyOrigin(d.fingerprint, d.derivationPath)));
  const userWallets = await walletRepository.findAccessibleWithSelect(userId, {
    id: true,
    name: true,
    scriptType: true,
    descriptor: true,
  }, { descriptor: { not: null } });

  for (const wallet of userWallets) {
    if (!wallet.descriptor || wallet.scriptType !== scriptType) continue;

    const existingOrigins = descriptorKeyOrigins(wallet.descriptor);
    if (existingOrigins.size === newOrigins.size &&
        [...newOrigins].every(origin => existingOrigins.has(origin))) {
      throw new ConflictError(`A wallet with these devices already exists: "${wallet.name}"`);
    }
  }
}
