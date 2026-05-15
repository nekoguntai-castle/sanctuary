/**
 * Device Registration Service
 *
 * Owns device registration, duplicate detection, and account merge behavior.
 */

import {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import { InvalidInputError } from '../errors';
import { deviceRepository } from '../repositories';
import { createLogger } from '../utils/logger';
import {
  compareAccounts,
  normalizeIncomingAccounts,
} from './deviceAccountConflicts';
import type {
  AccountComparisonResult,
  DeviceAccountInput,
} from './deviceAccountConflicts';

const log = createLogger('DEVICE:SVC_REGISTRATION');

type ExistingDevice = NonNullable<Awaited<ReturnType<typeof deviceRepository.findByFingerprintWithAccounts>>>;
type DeviceResponse = Awaited<ReturnType<typeof deviceRepository.findByIdWithModelAndAccounts>>;

export interface RegisterDeviceInput {
  type?: string;
  label?: string;
  fingerprint?: string;
  derivationPath?: string;
  xpub?: string;
  modelSlug?: string;
  accounts?: DeviceAccountInput[];
  merge?: boolean;
}

export type RegisterDeviceResult =
  | {
    kind: 'created';
    device: DeviceResponse;
  }
  | {
    kind: 'merged';
    message: string;
    device: DeviceResponse | ExistingDevice;
    added: number;
  }
  | {
    kind: 'merge-conflict';
    existingDevice: Pick<ExistingDevice, 'id' | 'label' | 'fingerprint'>;
    conflictingAccounts: AccountComparisonResult['conflictingAccounts'];
  }
  | {
    kind: 'duplicate';
    existingDevice: Pick<ExistingDevice, 'id' | 'label' | 'fingerprint' | 'type' | 'model' | 'accounts'>;
    comparison: AccountComparisonResult;
  };

/**
 * Register a hardware device or merge accounts into an existing device.
 */
export async function registerDevice(
  userId: string,
  input: RegisterDeviceInput
): Promise<RegisterDeviceResult> {
  const {
    type,
    label,
    fingerprint: rawFingerprint,
    derivationPath,
    xpub,
    modelSlug,
    accounts,
    merge,
  } = input;

  if (!type || !label || !rawFingerprint) {
    throw new InvalidInputError('type, label, and fingerprint are required');
  }

  const fingerprint = rawFingerprint.toLowerCase();

  if (!xpub && (!accounts || accounts.length === 0)) {
    throw new InvalidInputError('Either xpub or accounts array is required');
  }

  const normalized = normalizeIncomingAccounts(accounts, xpub, derivationPath);
  if ('error' in normalized) {
    throw new InvalidInputError(normalized.error);
  }
  const incomingAccounts = normalized.accounts;

  const existingDevice = await deviceRepository.findByFingerprintWithAccounts(fingerprint);

  if (existingDevice) {
    return handleExistingDevice(existingDevice, incomingAccounts, fingerprint, merge);
  }

  return createNewDevice(userId, {
    type,
    label,
    fingerprint,
    modelSlug,
    incomingAccounts,
  });
}

async function handleExistingDevice(
  existingDevice: ExistingDevice,
  incomingAccounts: DeviceAccountInput[],
  fingerprint: string,
  merge: boolean | undefined,
): Promise<RegisterDeviceResult> {
  const comparison = compareAccounts(existingDevice.accounts, incomingAccounts);

  if (merge === true) {
    if (comparison.conflictingAccounts.length > 0) {
      return {
        kind: 'merge-conflict',
        existingDevice: {
          id: existingDevice.id,
          label: existingDevice.label,
          fingerprint: existingDevice.fingerprint,
        },
        conflictingAccounts: comparison.conflictingAccounts,
      };
    }

    if (comparison.newAccounts.length === 0) {
      return {
        kind: 'merged',
        message: 'Device already has all these accounts',
        device: existingDevice,
        added: 0,
      };
    }

    const addedAccounts = await deviceRepository.mergeAccounts(existingDevice.id, comparison.newAccounts);

    log.info('Merged accounts into existing device', {
      deviceId: existingDevice.id,
      fingerprint,
      addedCount: addedAccounts.length,
      paths: comparison.newAccounts.map(a => a.derivationPath),
    });

    const updatedDevice = await deviceRepository.findByIdWithModelAndAccounts(existingDevice.id);

    return {
      kind: 'merged',
      message: `Added ${addedAccounts.length} new account(s) to existing device`,
      device: updatedDevice,
      added: addedAccounts.length,
    };
  }

  return {
    kind: 'duplicate',
    existingDevice: {
      id: existingDevice.id,
      label: existingDevice.label,
      fingerprint: existingDevice.fingerprint,
      type: existingDevice.type,
      model: existingDevice.model,
      accounts: existingDevice.accounts,
    },
    comparison,
  };
}

async function createNewDevice(
  userId: string,
  input: {
    type: string;
    label: string;
    fingerprint: string;
    modelSlug?: string;
    incomingAccounts: DeviceAccountInput[];
  }
): Promise<RegisterDeviceResult> {
  let modelId: string | undefined;
  if (input.modelSlug) {
    const model = await deviceRepository.findHardwareModel(input.modelSlug);
    if (model) {
      modelId = model.id;
    }
  }

  const primaryAccount = input.incomingAccounts.find(
    a =>
      a.purpose === DeviceAccountPurpose.SINGLE_SIG &&
      a.scriptType === WalletScriptType.NATIVE_SEGWIT
  ) || input.incomingAccounts[0];

  const device = await deviceRepository.createWithOwnerAndAccounts(
    {
      userId,
      type: input.type,
      label: input.label,
      fingerprint: input.fingerprint,
      derivationPath: primaryAccount?.derivationPath,
      xpub: primaryAccount?.xpub,
      modelId,
    },
    input.incomingAccounts,
  );

  log.info('Device registered', {
    deviceId: device.id,
    fingerprint: input.fingerprint,
    accountCount: input.incomingAccounts.length,
    purposes: input.incomingAccounts.map(a => a.purpose),
  });

  const deviceWithAccounts = await deviceRepository.findByIdWithModelAndAccounts(device.id);

  return {
    kind: 'created',
    device: deviceWithAccounts,
  };
}
