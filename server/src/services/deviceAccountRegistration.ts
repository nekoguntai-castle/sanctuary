import { MasterFingerprintSchema } from '@sanctuary/shared/schemas/deviceIdentity';
import { ConflictError, InvalidInputError, NotFoundError } from '../errors';
import { deviceRepository } from '../repositories';
import { assertHardwareWalletCapability } from './hardwareWalletCapabilities';
import type { DeviceAccountInput } from './deviceAccountConflicts';

export interface AddDeviceAccountInput extends DeviceAccountInput {
  masterFingerprint: string;
}

function parseMasterFingerprint(value: string, label: string): string {
  const result = MasterFingerprintSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidInputError(`${label}: ${result.error.issues[0].message}`);
  }
  return result.data;
}

/**
 * Adds an account only after proving that the connected signer has the same
 * BIP32 master fingerprint as the immutable device record. This prevents an
 * xpub from a different signer being attached to an existing device.
 */
export async function addDeviceAccountWithEvidence(
  deviceId: string,
  input: AddDeviceAccountInput,
) {
  const device = await deviceRepository.findByIdWithModelAndAccounts(deviceId);
  if (!device) {
    throw new NotFoundError('Device not found');
  }

  assertHardwareWalletCapability(device, 'account_add');

  const connectedFingerprint = parseMasterFingerprint(input.masterFingerprint, 'Connected device');
  const storedFingerprint = parseMasterFingerprint(device.fingerprint, 'Stored device');
  if (connectedFingerprint !== storedFingerprint) {
    throw new InvalidInputError('Connected device master fingerprint does not match the stored device');
  }

  const existingAccount = await deviceRepository.findDuplicateAccount(
    deviceId,
    input.derivationPath,
    input.purpose,
    input.scriptType,
  );
  if (existingAccount) {
    throw new ConflictError('An account with this derivation path already exists');
  }

  return deviceRepository.createAccount({
    deviceId,
    purpose: input.purpose,
    scriptType: input.scriptType,
    derivationPath: input.derivationPath,
    xpub: input.xpub,
  });
}
