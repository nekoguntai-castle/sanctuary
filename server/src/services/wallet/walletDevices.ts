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
import { walletRepository, deviceRepository, addressRepository } from '../../repositories';
import * as descriptorBuilder from '../bitcoin/descriptorBuilder';
import { createLogger } from '../../utils/logger';
import { ConflictError, WalletNotFoundError, DeviceNotFoundError } from '../../errors';
import { getErrorMessage } from '../../utils/errors';
import { generateInitialAddresses } from './addressGeneration';
import type { WalletNetwork } from './types';
import {
  assertHardwareWalletCapability,
  assertWalletHardwareCapability,
} from '../hardwareWalletCapabilities';

const log = createLogger('WALLET:SVC_DEVICE');

/**
 * Add device to wallet
 */
export async function addDeviceToWallet(
  walletId: string,
  deviceId: string,
  userId: string,
  signerIndex?: number
): Promise<void> {
  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithAccessAndDevices(walletId, userId);

  if (!wallet) {
    throw new WalletNotFoundError(walletId);
  }

  // Check device belongs to user
  const device = await deviceRepository.findByIdAndUser(deviceId, userId);

  if (!device) {
    throw new DeviceNotFoundError(deviceId);
  }

  assertWalletHardwareCapability(wallet, 'account_add');
  assertHardwareWalletCapability(device, 'account_add');

  // Check if device is already attached to this wallet
  const existingLink = wallet.devices.find(wd => wd.deviceId === deviceId);
  if (existingLink) {
    throw new ConflictError('Device is already linked to this wallet');
  }

  // Add device to wallet
  await walletRepository.linkDevice(walletId, deviceId, signerIndex);

  // Regenerate descriptor if wallet now has enough devices
  const allDevices = [...wallet.devices.map(wd => wd.device), device];
  const walletType = parseWalletType(wallet.type);
  const walletScriptType = parseWalletScriptType(wallet.scriptType);
  const shouldGenerateDescriptor =
    (walletType === WalletType.SINGLE_SIG && allDevices.length === 1) ||
    (walletType === WalletType.MULTI_SIG && allDevices.length >= (wallet.totalSigners || 2));

  if (shouldGenerateDescriptor && !wallet.descriptor && walletType && walletScriptType) {
    // Build descriptor from all linked devices
    const deviceInfos = allDevices.map(d => ({
      fingerprint: d.fingerprint,
      xpub: d.xpub,
      derivationPath: d.derivationPath || undefined,
    }));

    try {
      const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
        deviceInfos,
        {
          type: walletType,
          scriptType: walletScriptType,
          network: wallet.network as WalletNetwork,
          quorum: wallet.quorum || undefined,
        }
      );

      // Update wallet with new descriptor
      await walletRepository.update(walletId, {
        descriptor: descriptorResult.descriptor,
        fingerprint: descriptorResult.fingerprint,
      });

      log.info('Generated descriptor for wallet after device link', {
        walletId,
        deviceCount: allDevices.length,
      });
    } catch (err) {
      // Log but don't fail - device was still added
      log.warn('Failed to generate descriptor after device link', {
        walletId,
        error: getErrorMessage(err),
      });
    }
  }
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

  const devices = ownerWallet.devices.map(wd => wd.device);

  // Check device count requirements
  const walletType = parseWalletType(ownerWallet.type);
  const walletScriptType = parseWalletScriptType(ownerWallet.scriptType);
  if (!walletType || !walletScriptType) {
    return {
      success: false,
      message: 'Wallet type or script type is unsupported',
    };
  }

  if (walletType === WalletType.SINGLE_SIG && devices.length !== 1) {
    return {
      success: false,
      message: `Single-sig wallet needs exactly 1 device, but has ${devices.length}`
    };
  }

  if (walletType === WalletType.MULTI_SIG) {
    const requiredDevices = ownerWallet.totalSigners || 2;
    if (devices.length < requiredDevices) {
      return {
        success: false,
        message: `Multi-sig wallet needs ${requiredDevices} devices, but only has ${devices.length}`
      };
    }
  }

  // Build descriptor from devices
  const deviceInfos = devices.map(d => ({
    fingerprint: d.fingerprint,
    xpub: d.xpub,
    derivationPath: d.derivationPath || undefined,
  }));

  try {
    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      deviceInfos,
      {
        type: walletType,
        scriptType: walletScriptType,
        network: ownerWallet.network as WalletNetwork,
        quorum: ownerWallet.quorum || undefined,
      }
    );

    // Update wallet with descriptor
    await walletRepository.update(walletId, {
      descriptor: descriptorResult.descriptor,
      fingerprint: descriptorResult.fingerprint,
    });

    // Generate initial addresses
    const network = ownerWallet.network as WalletNetwork;
    const addressesToCreate = generateInitialAddresses(walletId, descriptorResult.descriptor, network);

    // skipDuplicates ensures idempotency - if repair is called multiple times
    // or addresses already exist from a partial repair, they won't cause errors
    await addressRepository.createMany(addressesToCreate, { skipDuplicates: true });

    log.info('Repaired wallet descriptor', {
      walletId,
      deviceCount: devices.length,
      addressesGenerated: addressesToCreate.length,
    });

    return {
      success: true,
      message: `Generated descriptor and ${addressesToCreate.length} addresses`
    };
  } catch (err) {
    log.error('Failed to repair wallet descriptor', {
      walletId,
      error: getErrorMessage(err),
    });
    throw new Error(`Failed to generate descriptor: ${getErrorMessage(err)}`);
  }
}
