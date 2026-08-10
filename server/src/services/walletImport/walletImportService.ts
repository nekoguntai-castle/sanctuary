/**
 * Wallet Import - Service Orchestrator
 *
 * Contains the shared wallet creation transaction logic and
 * the top-level auto-detect import orchestrator.
 */

import { withTransaction, type PrismaTxClient } from '../../models/prisma';
import {
  WalletScriptType,
  WalletType,
  accountPurposeForWalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import type {
  ParsedDescriptor,
  JsonImportConfig,
  Network,
  DetectedNetwork,
} from '../bitcoin/descriptorParser';
import { resolveDescriptorTextPair } from '../bitcoin/descriptorParser';
import { parseImportInput } from '../import';
import { getErrorMessage } from '../../utils/errors';
import { safeJsonParseUntyped } from '../../utils/safeJson';
import * as descriptorBuilder from '../bitcoin/descriptorBuilder';
import { createLogger } from '../../utils/logger';
import { resolveDevices } from './deviceResolution';
import { importFromDescriptor, importFromParsedData } from './descriptorImport';
import { importFromJson } from './jsonImport';
import {
  isBitcoinNetwork,
  resolveDetectedBitcoinNetwork,
  type BitcoinNetwork,
} from '../bitcoin/networks';
import type {
  DeviceResolution,
  ImportValidationResult,
  ImportWalletResult,
  ImportedDeviceInfo,
} from './types';
import { assertHardwareWalletCapability } from '../hardwareWalletCapabilities';
import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import type { WalletSignerLinkData } from '../../repositories/walletRepository';
import { assertSignerBindingMatchesWallet } from '../wallet/walletAccountSelection';
import type { WalletNetwork } from '../wallet/types';
import { buildInitialAddressTemplates } from '../wallet/addressGeneration';
import {
  descriptorPolicyFingerprint,
  prepareDescriptorPolicy,
  type PreparedDescriptorPolicy,
} from '../wallet/descriptorPolicy';

const log = createLogger('WALLET_IMPORT:SVC');

/** Input parameters for the shared wallet creation transaction */
interface CreateWalletTransactionInput {
  parsed: ParsedDescriptor;
  resolutions: DeviceResolution[];
  name: string;
  network: Network;
  deviceLabels?: Record<string, string>;
  jsonConfig?: JsonImportConfig;
  descriptorPolicy?: PreparedDescriptorPolicy;
}

type OriginalImportedDevice = NonNullable<JsonImportConfig['devices']>[number];
type AccountPurpose = ReturnType<typeof accountPurposeForWalletType>;

interface MaterializeDeviceContext {
  userId: string;
  accountPurpose: AccountPurpose;
  scriptType: WalletScriptType;
  deviceLabels?: Record<string, string>;
}

interface MaterializedDevice {
  info: ImportedDeviceInfo;
  created: boolean;
}

async function createImportedDevice(
  tx: PrismaTxClient,
  resolution: DeviceResolution,
  originalDevice: OriginalImportedDevice | undefined,
  context: MaterializeDeviceContext,
): Promise<MaterializedDevice> {
  /* v8 ignore start -- explicit per-fingerprint labels are optional import metadata */
  const label = context.deviceLabels?.[resolution.fingerprint]
    || resolution.suggestedLabel
    || `Device ${resolution.fingerprint.slice(0, 8)}`;
  /* v8 ignore stop */
  /* v8 ignore next -- resolution supplies the watch-only fallback */
  const deviceType = originalDevice?.type || resolution.originalType || 'watch_only';
  const newDevice = await tx.device.create({
    data: {
      userId: context.userId,
      type: deviceType,
      label,
      fingerprint: resolution.fingerprint,
      derivationPath: resolution.derivationPath,
      xpub: resolution.xpub,
    },
  });
  const account = await tx.deviceAccount.create({
    data: {
      deviceId: newDevice.id,
      purpose: context.accountPurpose,
      scriptType: context.scriptType,
      derivationPath: normalizeDerivationPath(resolution.derivationPath),
      xpub: resolution.xpub,
    },
  });
  await tx.deviceUser.create({
    data: { deviceId: newDevice.id, userId: context.userId, role: 'owner' },
  });
  return {
    created: true,
    info: {
      deviceId: newDevice.id,
      deviceAccountId: account.id,
      fingerprint: resolution.fingerprint,
      xpub: resolution.xpub,
      derivationPath: account.derivationPath,
      purpose: context.accountPurpose,
      scriptType: context.scriptType,
    },
  };
}

async function reuseImportedDevice(
  tx: PrismaTxClient,
  resolution: DeviceResolution,
  context: MaterializeDeviceContext,
): Promise<MaterializedDevice> {
  const deviceId = resolution.existingDeviceId;
  if (!deviceId) throw new Error('Existing device resolution is missing device id');
  const existingAccounts = await tx.deviceAccount.findMany({ where: { deviceId } });
  const derivationPath = normalizeDerivationPath(resolution.derivationPath);
  const accountsAtPath = existingAccounts.filter(
    (account) => normalizeDerivationPath(account.derivationPath) === derivationPath,
  );
  if (accountsAtPath.length > 1) {
    throw new Error(`Existing device account path ${derivationPath} is ambiguous`);
  }
  const [accountAtPath] = accountsAtPath;
  const matches = accountAtPath !== undefined
    && accountAtPath.purpose === context.accountPurpose
    && accountAtPath.scriptType === context.scriptType
    && accountAtPath.xpub === resolution.xpub;
  if (accountAtPath && !matches) {
    throw new Error(
      `Existing device account at ${derivationPath} does not exactly match the imported signer`,
    );
  }
  const account = matches && accountAtPath
    ? accountAtPath
    : await tx.deviceAccount.create({
      data: {
        deviceId,
        purpose: context.accountPurpose,
        scriptType: context.scriptType,
        derivationPath,
        xpub: resolution.xpub,
      },
    });
  /* v8 ignore next -- account creation and exact reuse are asserted by contracts */
  if (!matches) {
    log.info('Added new device account for import', {
      deviceId,
      purpose: context.accountPurpose,
      derivationPath,
    });
  }
  return {
    created: false,
    info: {
      deviceId,
      deviceAccountId: account.id,
      fingerprint: resolution.fingerprint,
      xpub: resolution.xpub,
      derivationPath,
      purpose: context.accountPurpose,
      scriptType: context.scriptType,
    },
  };
}

function materializeImportedDevice(
  tx: PrismaTxClient,
  resolution: DeviceResolution,
  originalDevice: OriginalImportedDevice | undefined,
  context: MaterializeDeviceContext,
): Promise<MaterializedDevice> {
  return resolution.willCreate
    ? createImportedDevice(tx, resolution, originalDevice, context)
    : reuseImportedDevice(tx, resolution, context);
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

  for (const resolution of resolutions) {
    if (resolution.originalType) {
      assertHardwareWalletCapability({ type: resolution.originalType }, 'import');
    }
    if (!resolution.willCreate) {
      assertHardwareWalletCapability({
        type: resolution.existingType,
        model: resolution.existingModel,
      }, 'import');
    }
  }

  // Determine account purpose from wallet type
  const accountPurpose = accountPurposeForWalletType(parsed.type);
  const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
    parsed.devices,
    {
      type: parsed.type,
      scriptType: parsed.scriptType,
      network,
      quorum: parsed.quorum,
    },
  );
  const descriptorPolicy = input.descriptorPolicy ?? prepareDescriptorPolicy({
    receiveDescriptor: descriptorResult.descriptor,
    changeDescriptor: descriptorResult.changeDescriptor,
    sourceKind: 'generated_pair',
  });
  const policyFingerprint = descriptorPolicyFingerprint(descriptorPolicy.descriptor);
  const initialAddresses = buildInitialAddressTemplates(
    descriptorPolicy.descriptor,
    descriptorPolicy.changeDescriptor,
    network as WalletNetwork,
  );

  return await withTransaction(async (tx) => {
    const createdDeviceIds: string[] = [];
    const reusedDeviceIds: string[] = [];
    // Track imported device info for building descriptor
    const importedDeviceInfos: ImportedDeviceInfo[] = [];

    const context: MaterializeDeviceContext = {
      userId,
      accountPurpose,
      scriptType: parsed.scriptType,
      deviceLabels,
    };
    for (let i = 0; i < resolutions.length; i++) {
      const resolution = resolutions[i];
      const materialized = await materializeImportedDevice(
        tx,
        resolution,
        jsonConfig?.devices[i],
        context,
      );
      assertSignerBindingMatchesWallet({
        deviceId: materialized.info.deviceId,
        deviceAccountId: materialized.info.deviceAccountId,
        signerFingerprint: materialized.info.fingerprint,
        signerXpub: materialized.info.xpub,
        signerDerivationPath: materialized.info.derivationPath,
        signerPurpose: materialized.info.purpose,
        signerScriptType: materialized.info.scriptType,
      }, {
        type: parsed.type,
        scriptType: parsed.scriptType,
        network: network as WalletNetwork,
      });
      (materialized.created ? createdDeviceIds : reusedDeviceIds).push(
        materialized.info.deviceId,
      );
      importedDeviceInfos.push(materialized.info);
    }

    // Create wallet
    const wallet = await tx.wallet.create({
      data: {
        name,
        type: parsed.type,
        scriptType: parsed.scriptType,
        network,
        quorum: parsed.quorum,
        totalSigners: parsed.totalSigners,
        ...descriptorPolicy,
        fingerprint: policyFingerprint,
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
      data: importedDeviceInfos.map((device, index): WalletSignerLinkData & { walletId: string } => ({
        walletId: wallet.id,
        deviceId: device.deviceId,
        deviceAccountId: device.deviceAccountId,
        signerIndex: index,
        signerBindingVersion: 1,
        signerFingerprint: device.fingerprint,
        signerXpub: device.xpub,
        signerDerivationPath: device.derivationPath,
        signerPurpose: device.purpose,
        signerScriptType: device.scriptType,
      })),
    });

    await tx.address.createMany({
      data: initialAddresses.map((address) => ({ walletId: wallet.id, ...address })),
    });

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
  input: {
    descriptor?: string;
    changeDescriptor?: string;
    json?: string;
    network?: Network;
  }
): Promise<ImportValidationResult> {
  const rawInput = input.descriptor || input.json;

  if (!rawInput) {
    return {
      valid: false,
      error: 'Either descriptor or json must be provided',
      format: 'descriptor',
      walletType: WalletType.SINGLE_SIG,
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      network: 'mainnet',
      devices: [],
    };
  }

  try {
    let parseResult: ReturnType<typeof parseImportInput>;
    if (input.descriptor) {
      const source = resolveDescriptorTextPair(input.descriptor, input.changeDescriptor);
      const policy = prepareDescriptorPolicy({
        receiveDescriptor: source.receiveDescriptor,
        changeDescriptor: source.changeDescriptor,
        sourceKind: 'imported',
      });
      parseResult = {
        format: 'descriptor',
        parsed: parseImportInput(policy.descriptor).parsed,
      };
    } else {
      parseResult = parseImportInput(rawInput);
    }
    const network = resolveImportNetwork(parseResult.parsed.network, input.network);

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
      network,
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
      walletType: WalletType.SINGLE_SIG,
      scriptType: WalletScriptType.NATIVE_SEGWIT,
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

  // Preserve descriptor pairs embedded in wallet-export JSON before the
  // general parser collapses the export to its receive-side parsed model.
  if (trimmed.startsWith('{')) {
    const walletExport = safeJsonParseUntyped<{
      descriptor?: string;
      changeDescriptor?: string;
    } | null>(trimmed, null, 'wallet export parse');
    if (walletExport && typeof walletExport.descriptor === 'string') {
      return importFromDescriptor(userId, {
        descriptor: walletExport.descriptor,
        changeDescriptor: walletExport.changeDescriptor,
        name: input.name,
        network: input.network,
        deviceLabels: input.deviceLabels,
      });
    }
  }

  if (trimmed.includes('<0;1>/*')) {
    // Route the only supported BIP389 policy through the exact-source path.
    return importFromDescriptor(userId, {
      descriptor: trimmed,
      name: input.name,
      network: input.network,
      deviceLabels: input.deviceLabels,
    });
  }

  // Use unified parser to detect format
  const parseResult = parseImportInput(trimmed);

  // For wallet_export format (JSON with descriptor field), extract and use the descriptor
  if (parseResult.format === 'wallet_export') {
    // Parse the JSON to get the descriptor
    throw new Error('Invalid JSON in wallet export data');
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

export function parseRequestedImportNetwork(value: unknown): Network | undefined {
  return isBitcoinNetwork(value) ? value : undefined;
}

export function resolveImportNetwork(
  detected: DetectedNetwork | undefined,
  requested?: Network,
): Network {
  return resolveDetectedBitcoinNetwork(
    detected,
    requested as BitcoinNetwork | undefined,
  ) as Network;
}
