/**
 * Wallet Creation
 *
 * Self-contained wallet creation flow including descriptor building,
 * initial address generation, and audit hook execution.
 */

import { deviceRepository, addressRepository, walletRepository } from '../../repositories';
import * as descriptorBuilder from '../bitcoin/descriptorBuilder';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { hookRegistry, Operations } from '../hooks';
import { InvalidInputError, DeviceNotFoundError } from '../../errors';
import { generateInitialAddresses } from './addressGeneration';
import type { CreateWalletInput, WalletWithBalance } from './types';

const log = createLogger('WALLET:SVC_CREATE');

/**
 * Create a new wallet
 */
export async function createWallet(
  userId: string,
  input: CreateWalletInput
): Promise<WalletWithBalance> {
  // Validate multi-sig parameters
  if (input.type === 'multi_sig') {
    if (!input.quorum || !input.totalSigners) {
      throw new InvalidInputError('Quorum and totalSigners required for multi-sig wallets');
    }
    if (input.quorum > input.totalSigners) {
      throw new InvalidInputError('Quorum cannot exceed total signers');
    }
  }

  let descriptor = input.descriptor;
  let fingerprint = input.fingerprint;

  // If device IDs provided, fetch devices and generate descriptor
  if (input.deviceIds && input.deviceIds.length > 0) {
    // Fetch devices with their accounts
    const devices = await deviceRepository.findByIdsAndUserWithAccounts(input.deviceIds, userId);

    if (devices.length !== input.deviceIds.length) {
      throw new DeviceNotFoundError();
    }

    // Validate device count for wallet type
    if (input.type === 'single_sig' && devices.length !== 1) {
      throw new InvalidInputError('Single-sig wallet requires exactly 1 device');
    }
    if (input.type === 'multi_sig' && devices.length < 2) {
      throw new InvalidInputError('Multi-sig wallet requires at least 2 devices');
    }

    // Determine purpose based on wallet type
    const purpose = input.type === 'multi_sig' ? 'multisig' : 'single_sig';

    // Build descriptor from devices, selecting the correct account for wallet type
    const deviceInfos = devices.map(d => {
      // Try to find matching account by purpose and scriptType
      let account = d.accounts.find(
        a => a.purpose === purpose && a.scriptType === input.scriptType
      );

      // If no exact match, try to find any account with matching purpose
      if (!account) {
        account = d.accounts.find(a => a.purpose === purpose);
      }

      // If still no match and we have accounts, log warning and use first account
      if (!account && d.accounts.length > 0) {
        log.warn('No matching account found for wallet type, using first account', {
          deviceId: d.id,
          fingerprint: d.fingerprint,
          walletType: input.type,
          scriptType: input.scriptType,
          availableAccounts: d.accounts.map(a => ({
            purpose: a.purpose,
            scriptType: a.scriptType,
          })),
        });
        account = d.accounts[0];
      }

      // Use account data if found, otherwise fall back to legacy device fields
      const xpub = account?.xpub || d.xpub;
      const derivationPath = account?.derivationPath || d.derivationPath;

      // For multisig, warn if using single-sig account
      if (input.type === 'multi_sig' && account?.purpose === 'single_sig') {
        log.warn('Using single-sig account for multisig wallet - this may cause signing issues', {
          deviceId: d.id,
          fingerprint: d.fingerprint,
          accountPath: account.derivationPath,
          hint: 'Consider adding a multisig account to this device',
        });
      }

      return {
        fingerprint: d.fingerprint,
        xpub,
        derivationPath: derivationPath || undefined,
      };
    });

    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      deviceInfos,
      {
        type: input.type,
        scriptType: input.scriptType,
        network: input.network || 'mainnet',
        quorum: input.quorum,
      }
    );

    descriptor = descriptorResult.descriptor;
    fingerprint = descriptorResult.fingerprint;
  }

  // Create wallet in database with atomic device linking
  const wallet = await walletRepository.createWithDeviceLinks(
    {
      name: input.name,
      type: input.type,
      scriptType: input.scriptType,
      network: input.network || 'mainnet',
      quorum: input.quorum,
      totalSigners: input.totalSigners,
      descriptor,
      fingerprint,
      /* v8 ignore start -- group association is optional and covered by admin group flows */
      group: input.groupId ? { connect: { id: input.groupId } } : undefined,
      /* v8 ignore stop */
      users: {
        create: {
          userId,
          role: 'owner',
        },
      },
    },
    input.deviceIds,
  );

  // Generate initial addresses if wallet has a descriptor
  if (descriptor) {
    try {
      const network = (input.network || 'mainnet') as 'mainnet' | 'testnet' | 'regtest';
      const addressesToCreate = generateInitialAddresses(wallet.id, descriptor, network);
      await addressRepository.createMany(addressesToCreate);
    } catch (err) {
      log.error('Failed to generate initial addresses', { error: getErrorMessage(err) });
      // Don't fail wallet creation if address generation fails
    }
  }

  // Re-fetch wallet with addresses
  const walletWithAddresses = await walletRepository.findByIdWithSelect(wallet.id, {
    id: true,
    addresses: true,
  });

  const result = {
    ...wallet,
    balance: 0,
    deviceCount: wallet.devices.length,
    addressCount: walletWithAddresses?.addresses.length || 0,
    isShared: false,
  };

  // Execute after hooks for audit logging
  hookRegistry.executeAfter(Operations.WALLET_CREATE, input, {
    userId,
    result,
    success: true,
  }).catch(err => log.warn('After hook failed', { error: getErrorMessage(err) }));

  return result;
}
