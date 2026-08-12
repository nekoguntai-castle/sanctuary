/**
 * Wallet Device Operations
 *
 * Device-to-wallet linking and descriptor generation.
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
 * Compatibility symbol for the retired direct-repair boundary.
 *
 * All remediation must go through a content-addressed preview and exact approval.
 */
export async function repairWalletDescriptor(
  _walletId: string,
  _userId: string,
): Promise<{ success: boolean; message: string }> {
  throw new ConflictError(
    'Direct wallet repair is retired. Create and approve an immutable remediation preview.',
  );
}
