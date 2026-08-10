/**
 * Wallet Device Operations
 *
 * Device-to-wallet linking and descriptor generation/repair.
 */

import {
  WalletType,
  parseWalletScriptType,
  parseWalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import { walletRepository, deviceRepository } from '../../repositories';
import * as descriptorBuilder from '../bitcoin/descriptorBuilder';
import { createLogger } from '../../utils/logger';
import {
  ConflictError,
  InvalidInputError,
  WalletNotFoundError,
  DeviceNotFoundError,
} from '../../errors';
import { getErrorMessage } from '../../utils/errors';
import { generateInitialAddresses } from './addressGeneration';
import { prepareDescriptorPolicy } from './descriptorPolicy';
import type { WalletNetwork, WalletSignerBinding, WalletSignerInput } from './types';
import {
  assertSignerBindingMatchesWallet,
  descriptorDeviceInfo,
  resolveWalletSignerBindings,
} from './walletAccountSelection';
import {
  assertHardwareWalletCapability,
  assertWalletHardwareCapability,
} from '../hardwareWalletCapabilities';
import {
  canonicalPolicyIdentity,
  requireCanonicalWalletPolicy,
} from './canonicalPolicy';

const log = createLogger('WALLET:SVC_DEVICE');

type WalletWithSignerDevices = NonNullable<Awaited<
  ReturnType<typeof walletRepository.findByIdWithAccessAndDevices>
>>;
type StoredSignerLink = WalletWithSignerDevices['devices'][number];

function walletPolicy(wallet: WalletWithSignerDevices) {
  const type = parseWalletType(wallet.type);
  const scriptType = parseWalletScriptType(wallet.scriptType);
  if (!type || !scriptType) {
    throw new InvalidInputError('Wallet type or script type is unsupported');
  }
  return { type, scriptType };
}

function orderedStoredSignerInfo(wallet: WalletWithSignerDevices) {
  const policy = walletPolicy(wallet);
  const links = wallet.devices;
  const ordered = [...links].sort((left, right) =>
    (left.signerIndex ?? Number.MAX_SAFE_INTEGER) -
    (right.signerIndex ?? Number.MAX_SAFE_INTEGER)
  );
  return ordered.map((link, index) => {
    if (
      link.signerBindingVersion !== 1
      || link.signerIndex !== index
      || !link.signerFingerprint
      || !link.signerXpub
      || !link.signerDerivationPath
      || !link.signerPurpose
      || !link.signerScriptType
    ) {
      throw new InvalidInputError(
        'Wallet has an unproven legacy signer link and cannot change its descriptor',
      );
    }
    assertSignerBindingMatchesWallet({
      deviceId: link.deviceId,
      deviceAccountId: link.deviceAccountId ?? `snapshot:${link.deviceId}`,
      signerFingerprint: link.signerFingerprint,
      signerXpub: link.signerXpub,
      signerDerivationPath: link.signerDerivationPath,
      signerPurpose: link.signerPurpose,
      signerScriptType: link.signerScriptType,
    }, {
      type: policy.type,
      scriptType: policy.scriptType,
      network: wallet.network as WalletNetwork,
    });
    return {
      fingerprint: link.signerFingerprint,
      xpub: link.signerXpub,
      derivationPath: link.signerDerivationPath,
    };
  });
}

function buildDescriptorAssignment(
  walletId: string,
  wallet: WalletWithSignerDevices,
  deviceInfos: ReturnType<typeof orderedStoredSignerInfo>,
) {
  const policy = walletPolicy(wallet);
  const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(deviceInfos, {
    type: policy.type,
    scriptType: policy.scriptType,
    network: wallet.network as WalletNetwork,
    quorum: wallet.quorum || undefined,
  });
  const descriptorPolicy = prepareDescriptorPolicy({
    receiveDescriptor: descriptorResult.descriptor,
    changeDescriptor: descriptorResult.changeDescriptor,
    sourceKind: 'generated_pair',
  });
  const canonicalIdentity = canonicalPolicyIdentity(
    requireCanonicalWalletPolicy(policy.type, policy.scriptType),
  );
  return {
    ...descriptorPolicy,
    ...canonicalIdentity,
    fingerprint: descriptorResult.fingerprint,
    addresses: generateInitialAddresses(
      walletId,
      descriptorPolicy.descriptor,
      wallet.network as WalletNetwork,
      descriptorPolicy.changeDescriptor,
      canonicalIdentity,
    ),
  };
}

function expectedSignerCount(wallet: WalletWithSignerDevices): number {
  const walletType = parseWalletType(wallet.type);
  if (walletType === WalletType.SINGLE_SIG) return 1;
  if (walletType === WalletType.MULTI_SIG && wallet.totalSigners) {
    return wallet.totalSigners;
  }
  throw new InvalidInputError('Wallet signer count is not configured');
}

async function resolveNewSignerBinding(
  userId: string,
  wallet: WalletWithSignerDevices,
  signer: WalletSignerInput,
): Promise<WalletSignerBinding> {
  const devices = await deviceRepository.findByIdsAndUserWithAccounts(
    [signer.deviceId],
    userId,
  );
  if (devices.length !== 1) throw new DeviceNotFoundError(signer.deviceId);
  assertHardwareWalletCapability(devices[0], 'account_add');

  const policy = walletPolicy(wallet);
  const [binding] = resolveWalletSignerBindings(devices, {
    type: policy.type,
    scriptType: policy.scriptType,
    network: wallet.network as WalletNetwork,
    signers: [{ ...signer, signerIndex: 0 }],
  });
  return { ...binding, signerIndex: signer.signerIndex };
}

/**
 * Add device to wallet
 */
export async function addDeviceToWallet(
  walletId: string,
  signer: WalletSignerInput,
  userId: string,
): Promise<void> {
  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithAccessAndDevices(walletId, userId);

  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }

  assertWalletHardwareCapability(wallet, 'account_add');

  if (wallet.descriptor) {
    throw new ConflictError('Cannot add a signer after the wallet descriptor is assigned');
  }

  // Check if device is already attached to this wallet
  const existingLink = wallet.devices.find(wd => wd.deviceId === signer.deviceId);
  if (existingLink) {
    throw new ConflictError('Device is already linked to this wallet');
  }

  const existingInfos = orderedStoredSignerInfo(wallet);
  if (signer.signerIndex !== existingInfos.length) {
    throw new InvalidInputError('Signer index must be the next contiguous wallet signer index');
  }
  const binding = await resolveNewSignerBinding(userId, wallet, signer);
  const signerCount = wallet.devices.length + 1;
  const requiredSigners = expectedSignerCount(wallet);
  if (signerCount > requiredSigners) {
    throw new InvalidInputError('Wallet already has its configured number of signers');
  }

  if (signerCount < requiredSigners) {
    await walletRepository.linkDevice(walletId, binding);
    return;
  }

  const assignment = buildDescriptorAssignment(
    walletId,
    wallet,
    [...existingInfos, descriptorDeviceInfo(binding)],
  );
  await walletRepository.linkDeviceWithDescriptor(walletId, binding, assignment);
  log.info('Generated descriptor for wallet after exact signer binding', {
    walletId,
    deviceCount: signerCount,
  });
}

/**
 * Repair wallet descriptor
 *
 * Regenerates the Bitcoin descriptor from attached hardware devices for wallets
 * that have devices linked but are missing a descriptor. This can happen when
 * a multisig wallet is created before all devices are added.
 *
 * Security: Only wallet owners can repair descriptors. This prevents unauthorized
 * users from regenerating descriptors which could theoretically be used to derive
 * addresses. The operation is safe because descriptors are deterministically
 * derived from the immutable device xpubs - the same devices will always
 * produce the same descriptor.
 *
 * @param walletId - The wallet to repair
 * @param userId - The user requesting the repair (must be owner)
 * @returns Success status and message
 * @throws Error if wallet not found or user is not owner
 */
export async function repairWalletDescriptor(
  walletId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  // Owner-only check: repair requires wallet ownership
  const ownerWallet = await walletRepository.findByIdWithOwnerAndDevices(walletId, userId);
  if (!ownerWallet) {
    throw new WalletNotFoundError(walletId);
  }

  if (ownerWallet.descriptor) {
    return { success: true, message: 'Wallet already has a descriptor' };
  }

  assertWalletHardwareCapability(ownerWallet, 'import');

  const walletType = parseWalletType(ownerWallet.type);
  if (!walletType) {
    return {
      success: false,
      message: 'Wallet type or script type is unsupported',
    };
  }

  const requiredDevices = walletType === WalletType.SINGLE_SIG
    ? 1
    : ownerWallet.totalSigners;
  if (!requiredDevices || ownerWallet.devices.length !== requiredDevices) {
    return {
      success: false,
      message: requiredDevices
        ? `Wallet needs ${requiredDevices} ${requiredDevices === 1 ? 'device' : 'devices'}, but has ${ownerWallet.devices.length}`
        : 'Wallet is missing its configured signer count',
    };
  }

  try {
    const assignment = buildDescriptorAssignment(
      walletId,
      ownerWallet,
      orderedStoredSignerInfo(ownerWallet),
    );
    await walletRepository.assignDescriptorWithAddresses(walletId, assignment);

    log.info('Repaired wallet descriptor', {
      walletId,
      deviceCount: ownerWallet.devices.length,
      addressesGenerated: assignment.addresses.length,
    });

    return {
      success: true,
      message: `Generated descriptor and ${assignment.addresses.length} addresses`
    };
  } catch (err) {
    log.error('Failed to repair wallet descriptor', {
      walletId,
      error: getErrorMessage(err),
    });
    throw new Error(`Failed to generate descriptor: ${getErrorMessage(err)}`);
  }
}
