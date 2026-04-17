/**
 * Wallet Import - Service Orchestrator
 *
 * Contains the shared wallet creation transaction logic and
 * the top-level auto-detect import orchestrator.
 */

import { withTransaction } from '../../models/prisma';
import type {
  ParsedDescriptor,
  JsonImportConfig,
  Network,
} from '../bitcoin/descriptorParser';
import { parseImportInput } from '../import';
import { getErrorMessage } from '../../utils/errors';
import { safeJsonParseUntyped } from '../../utils/safeJson';
import * as descriptorBuilder from '../bitcoin/descriptorBuilder';
import * as addressDerivation from '../bitcoin/addressDerivation';
import { createLogger } from '../../utils/logger';
import { INITIAL_ADDRESS_COUNT } from '../../constants';
import { resolveDevices } from './deviceResolution';
import { importFromDescriptor, importFromParsedData } from './descriptorImport';
import { importFromJson } from './jsonImport';
import type {
  DeviceResolution,
  ImportValidationResult,
  ImportWalletResult,
  ImportedDeviceInfo,
} from './types';

const log = createLogger('WALLET_IMPORT:SVC');

/** Input parameters for the shared wallet creation transaction */
interface CreateWalletTransactionInput {
  parsed: ParsedDescriptor;
  resolutions: DeviceResolution[];
  name: string;
  network: Network;
  deviceLabels?: Record<string, string>;
  jsonConfig?: JsonImportConfig;
}

/**
 * Shared transaction logic for creating devices and wallet.
 *
 * Used by both descriptor import and JSON import paths to avoid
 * duplicating the complex Prisma transaction.
 */
export async function createWalletTransaction(
  userId: string,
  input: CreateWalletTransactionInput
): Promise<ImportWalletResult> {
  const { parsed, resolutions, name, network, deviceLabels, jsonConfig } = input;

  // Determine account purpose from wallet type
  const accountPurpose = parsed.type === 'multi_sig' ? 'multisig' : 'single_sig';

  return await withTransaction(async (tx) => {
    const createdDeviceIds: string[] = [];
    const reusedDeviceIds: string[] = [];
    const deviceIdsForWallet: string[] = [];
    // Track imported device info for building descriptor
    const importedDeviceInfos: ImportedDeviceInfo[] = [];

    // Create or reuse devices
    for (let i = 0; i < resolutions.length; i++) {
      const resolution = resolutions[i];
      const originalDevice = jsonConfig?.devices[i];

      if (resolution.willCreate) {
        // Determine label: from explicit deviceLabels, from JSON config, or from suggestion
        /* v8 ignore start -- explicit per-fingerprint labels are optional import metadata */
        const label =
          deviceLabels?.[resolution.fingerprint] ||
          resolution.suggestedLabel ||
          `Device ${resolution.fingerprint.slice(0, 8)}`;
        /* v8 ignore stop */

        // originalType may be absent when importing from descriptor-only formats (no device metadata)
        /* v8 ignore next -- original device metadata is optional for descriptor-only imports */
        const deviceType = originalDevice?.type || resolution.originalType || 'hardware';

        const newDevice = await tx.device.create({
          data: {
            userId,
            type: deviceType,
            label,
            fingerprint: resolution.fingerprint,
            derivationPath: resolution.derivationPath,
            xpub: resolution.xpub,
          },
        });

        // Create DeviceAccount for this wallet's purpose
        await tx.deviceAccount.create({
          data: {
            deviceId: newDevice.id,
            purpose: accountPurpose,
            scriptType: parsed.scriptType,
            derivationPath: resolution.derivationPath,
            xpub: resolution.xpub,
          },
        });

        // Create DeviceUser record for access control
        await tx.deviceUser.create({
          data: {
            deviceId: newDevice.id,
            userId,
            role: 'owner',
          },
        });

        createdDeviceIds.push(newDevice.id);
        deviceIdsForWallet.push(newDevice.id);
      } else {
        const existingDeviceId = resolution.existingDeviceId;
        if (!existingDeviceId) {
          throw new Error('Existing device resolution is missing device id');
        }

        // Device exists - check if we need to add the account with imported derivation path
        const existingAccounts = await tx.deviceAccount.findMany({
          where: { deviceId: existingDeviceId },
        });

        const hasMatchingAccount = existingAccounts.some(
          (a) => a.purpose === accountPurpose && a.derivationPath === resolution.derivationPath
        );

        if (!hasMatchingAccount) {
          await tx.deviceAccount.create({
            data: {
              deviceId: existingDeviceId,
              purpose: accountPurpose,
              scriptType: parsed.scriptType,
              derivationPath: resolution.derivationPath,
              xpub: resolution.xpub,
            },
          });
          log.info('Added new device account for import', {
            deviceId: existingDeviceId,
            purpose: accountPurpose,
            derivationPath: resolution.derivationPath,
          });
        }

        reusedDeviceIds.push(existingDeviceId);
        deviceIdsForWallet.push(existingDeviceId);
      }

      // Always use the IMPORTED derivation path/xpub for building the descriptor
      importedDeviceInfos.push({
        fingerprint: resolution.fingerprint,
        xpub: resolution.xpub,
        derivationPath: resolution.derivationPath,
      });
    }

    // Build descriptor using IMPORTED device info (not stored device paths)
    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      importedDeviceInfos,
      {
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
      }
    );

    // Create wallet
    const wallet = await tx.wallet.create({
      data: {
        name,
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
        totalSigners: parsed.totalSigners,
        descriptor: descriptorResult.descriptor,
        fingerprint: descriptorResult.fingerprint,
        users: {
          create: {
            userId,
            role: 'owner',
          },
        },
      },
    });

    // Link devices to wallet
    await tx.walletDevice.createMany({
      data: deviceIdsForWallet.map((deviceId, index) => ({
        walletId: wallet.id,
        deviceId,
        signerIndex: index,
      })),
    });

    // Generate initial addresses (both receive and change)
    try {
      const addressesToCreate = [];

      // Generate receive addresses (change = false)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(
            descriptorResult.descriptor,
            i,
            { network, change: false }
          );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      // Generate change addresses (change = true)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(
            descriptorResult.descriptor,
            i,
            { network, change: true }
          );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      await tx.address.createMany({
        data: addressesToCreate,
      });
    } catch (err) {
      log.error('Failed to generate initial addresses', { error: getErrorMessage(err) });
    }

    return {
      wallet: {
        id: wallet.id,
        name: wallet.name,
        type: wallet.type,
        scriptType: wallet.scriptType,
        network: wallet.network,
        quorum: wallet.quorum,
        totalSigners: wallet.totalSigners,
        descriptor: wallet.descriptor,
      },
      devicesCreated: createdDeviceIds.length,
      devicesReused: reusedDeviceIds.length,
      createdDeviceIds,
      reusedDeviceIds,
    };
  });
}

/**
 * Validate import data and preview what will happen
 * (without actually creating anything)
 */
export async function validateImport(
  userId: string,
  input: { descriptor?: string; json?: string }
): Promise<ImportValidationResult> {
  const rawInput = input.descriptor || input.json;

  if (!rawInput) {
    return {
      valid: false,
      error: 'Either descriptor or json must be provided',
      format: 'descriptor',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
      network: 'mainnet',
      devices: [],
    };
  }

  try {
    // Use unified parser that handles all formats
    const parseResult = parseImportInput(rawInput);

    // Resolve devices
    const devices = await resolveDevices(
      userId,
      parseResult.parsed.devices,
      parseResult.originalDevices
    );

    return {
      valid: true,
      format: parseResult.format,
      walletType: parseResult.parsed.type,
      scriptType: parseResult.parsed.scriptType,
      network: parseResult.parsed.network,
      quorum: parseResult.parsed.quorum,
      totalSigners: parseResult.parsed.totalSigners,
      devices,
      suggestedName: parseResult.suggestedName,
    };
  } catch (e) {
    return {
      valid: false,
      error: getErrorMessage(e),
      format: input.json ? 'json' : 'descriptor',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
      network: 'mainnet',
      devices: [],
    };
  }
}

/**
 * Auto-detect format and import wallet
 */
export async function importWallet(
  userId: string,
  input: {
    data: string; // Either descriptor or JSON
    name: string;
    network?: Network;
    deviceLabels?: Record<string, string>;
  }
): Promise<ImportWalletResult> {
  const trimmed = input.data.trim();

  // Use unified parser to detect format
  const parseResult = parseImportInput(trimmed);

  // For wallet_export format (JSON with descriptor field), extract and use the descriptor
  if (parseResult.format === 'wallet_export') {
    // Parse the JSON to get the descriptor
    const walletExport = safeJsonParseUntyped<{ descriptor?: string } | null>(trimmed, null, 'wallet export parse');
    if (!walletExport || typeof walletExport.descriptor !== 'string') {
      throw new Error('Invalid JSON in wallet export data');
    }
    return importFromDescriptor(userId, {
      descriptor: walletExport.descriptor,
      name: input.name,
      network: input.network,
      deviceLabels: input.deviceLabels,
    });
  }

  // For our custom JSON config format
  if (parseResult.format === 'json') {
    return importFromJson(userId, {
      json: trimmed,
      name: input.name,
      network: input.network,
    });
  }

  // For BlueWallet text format - import using parsed data
  if (parseResult.format === 'bluewallet_text') {
    return importFromParsedData(userId, {
      parsed: parseResult.parsed,
      name: input.name,
      network: input.network,
      deviceLabels: input.deviceLabels,
    });
  }

  // For Coldcard JSON export - import using parsed data
  if (parseResult.format === 'coldcard') {
    return importFromParsedData(userId, {
      parsed: parseResult.parsed,
      name: input.name,
      network: input.network,
      deviceLabels: input.deviceLabels,
    });
  }

  // For plain descriptor format
  return importFromDescriptor(userId, {
    descriptor: trimmed,
    name: input.name,
    network: input.network,
    deviceLabels: input.deviceLabels,
  });
}
