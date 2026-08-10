/**
 * Wallets - Export Router
 *
 * Wallet export in various formats (BIP 329, Sparrow, etc.)
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { walletRepository, transactionRepository, addressRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { exportFormatRegistry, type WalletExportData } from '../../services/export';
import type { ScriptType, Network } from '../../services/bitcoin/descriptorParser';
import {
  WalletType,
  parseWalletScriptType,
  parseWalletType,
} from '@sanctuary/shared/constants/walletIdentity';
import { assertSignerBindingMatchesWallet } from '../../services/wallet/walletAccountSelection';
import type { WalletNetwork } from '../../services/wallet/types';
import {
  assertWalletHardwareCapability,
  assertWalletHardwareCapabilityById,
} from '../../services/hardwareWalletCapabilities';

const router = Router();

type ExportWallet = NonNullable<Awaited<ReturnType<typeof walletRepository.findByIdWithDevices>>>;
type ExportWalletDevice = ExportWallet['devices'][number];

function requiredSnapshotValue(
  value: string | null,
  field: string,
  signerIndex: number,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidInputError(`Wallet signer ${signerIndex} has an incomplete ${field} snapshot`);
  }
  return value;
}

function assertUniqueSnapshotValue(
  seen: Set<string>,
  value: string,
  field: string,
): void {
  if (seen.has(value)) {
    throw new InvalidInputError(`Wallet has duplicate signer ${field}: ${value}`);
  }
  seen.add(value);
}

function validateSignerCount(wallet: ExportWallet): void {
  if (wallet.type === WalletType.SINGLE_SIG && wallet.devices.length !== 1) {
    throw new InvalidInputError('Single-signature wallet must have exactly one signer snapshot');
  }
  if (
    wallet.type === WalletType.MULTI_SIG
    && (!Number.isSafeInteger(wallet.totalSigners) || (wallet.totalSigners ?? 0) <= 0)
  ) {
    throw new InvalidInputError('Multisignature wallet has an invalid signer count');
  }
  if (wallet.type === WalletType.MULTI_SIG && wallet.devices.length !== wallet.totalSigners) {
    throw new InvalidInputError('Multisignature wallet signer snapshots are incomplete');
  }
}

function signerSnapshotDevice(
  link: ExportWalletDevice,
  position: number,
  walletType: WalletType,
  walletScriptType: ScriptType,
  network: WalletNetwork,
  seenDeviceIds: Set<string>,
  seenAccountIds: Set<string>,
): WalletExportData['devices'][number] {
  if (link.signerIndex !== position) {
    throw new InvalidInputError('Wallet signer snapshots must be ordered and contiguous');
  }
  if (link.signerBindingVersion !== 1) {
    throw new InvalidInputError(`Wallet signer ${position} has an unsupported snapshot version`);
  }

  const fingerprint = requiredSnapshotValue(link.signerFingerprint, 'fingerprint', position);
  const xpub = requiredSnapshotValue(link.signerXpub, 'xpub', position);
  const derivationPath = requiredSnapshotValue(link.signerDerivationPath, 'derivation path', position);
  const purpose = requiredSnapshotValue(link.signerPurpose, 'purpose', position);
  const scriptType = requiredSnapshotValue(link.signerScriptType, 'script type', position);

  assertUniqueSnapshotValue(seenDeviceIds, link.deviceId, 'device');
  if (link.deviceAccountId) {
    assertUniqueSnapshotValue(seenAccountIds, link.deviceAccountId, 'account');
  }
  assertSignerBindingMatchesWallet({
    deviceId: link.deviceId,
    deviceAccountId: link.deviceAccountId ?? `snapshot:${link.deviceId}`,
    signerFingerprint: fingerprint,
    signerXpub: xpub,
    signerDerivationPath: derivationPath,
    signerPurpose: purpose,
    signerScriptType: scriptType,
  }, {
    type: walletType,
    scriptType: walletScriptType,
    network,
  });

  return {
    label: link.device.label,
    type: link.device.type,
    fingerprint,
    xpub,
    derivationPath,
    modelSlug: link.device.model?.slug || undefined,
    modelName: link.device.model?.name || undefined,
  };
}

/**
 * Build wallet export data from wallet with devices
 * Uses only the immutable signer snapshot captured when the wallet was linked.
 */
function buildWalletExportData(wallet: ExportWallet): WalletExportData {
  const walletType = parseWalletType(wallet.type);
  const scriptType = parseWalletScriptType(wallet.scriptType);
  if (!walletType || !scriptType) {
    throw new InvalidInputError('Wallet policy is invalid for export');
  }
  validateSignerCount(wallet);

  const seenDeviceIds = new Set<string>();
  const seenAccountIds = new Set<string>();

  return {
    id: wallet.id,
    name: wallet.name,
    type: walletType,
    scriptType: scriptType as ScriptType,
    network: wallet.network as Network,
    descriptor: wallet.descriptor || '',
    quorum: wallet.quorum || undefined,
    totalSigners: wallet.totalSigners || undefined,
    devices: wallet.devices.map((link, position) => signerSnapshotDevice(
      link,
      position,
      walletType,
      scriptType,
      wallet.network as WalletNetwork,
      seenDeviceIds,
      seenAccountIds,
    )),
    createdAt: wallet.createdAt,
  };
}

/**
 * GET /api/v1/wallets/:id/export/labels
 * Export wallet labels in BIP 329 format (JSON Lines)
 * https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki
 */
router.get('/:id/export/labels', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;

  // Get wallet name for filename
  const walletName = await walletRepository.getName(walletId);

  if (!walletName) {
    throw new NotFoundError('Wallet not found');
  }
  await assertWalletHardwareCapabilityById(walletId, 'display');

  // Get all transactions with labels
  const transactions = await transactionRepository.findWithLabels(walletId);

  // Get all addresses with labels
  const addresses = await addressRepository.findWithLabels(walletId);

  // Build BIP 329 JSON Lines
  const lines: string[] = [];

  // Transaction labels
  for (const tx of transactions) {
    // Combine label, memo, and tag labels
    const labelParts: string[] = [];
    if (tx.label) labelParts.push(tx.label);
    if (tx.memo) labelParts.push(tx.memo);
    for (const tl of tx.transactionLabels) {
      if (tl.label.name) labelParts.push(tl.label.name);
    }

    if (labelParts.length > 0) {
      lines.push(JSON.stringify({
        type: 'tx',
        ref: tx.txid,
        label: labelParts.join(', '),
      }));
    }
  }

  // Address labels
  for (const addr of addresses) {
    const labelParts: string[] = [];
    for (const al of addr.addressLabels) {
      if (al.label.name) labelParts.push(al.label.name);
    }

    if (labelParts.length > 0) {
      lines.push(JSON.stringify({
        type: 'addr',
        ref: addr.address,
        label: labelParts.join(', '),
        origin: addr.derivationPath || undefined,
      }));
    }
  }

  // Set response headers for file download
  const filename = `${walletName.replace(/[^a-zA-Z0-9]/g, '_')}_labels_bip329.jsonl`;
  res.setHeader('Content-Type', 'application/jsonl');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Send as newline-separated JSON
  res.send(lines.join('\n'));
}));

/**
 * GET /api/v1/wallets/:id/export/formats
 * Get available export formats for this wallet
 */
router.get('/:id/export/formats', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;

  // Get wallet to determine which formats are available
  const wallet = await walletRepository.findByIdWithDevices(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }
  assertWalletHardwareCapability(wallet, 'display');

  // Build wallet export data to check format availability
  const walletData = buildWalletExportData(wallet);

  // Get available formats
  const formats = exportFormatRegistry.getAvailableFormats(walletData).map((handler) => ({
    id: handler.id,
    name: handler.name,
    description: handler.description,
    extension: handler.fileExtension,
    mimeType: handler.mimeType,
  }));

  res.json({ formats });
}));

/**
 * GET /api/v1/wallets/:id/export
 * Export wallet in the specified format (default: sparrow)
 * Query params:
 *   format - Export format ID (sparrow, descriptor, bluewallet, coldcard)
 */
router.get('/:id/export', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const formatId = (req.query.format as string) || 'sparrow';

  // Get wallet with all related data
  const wallet = await walletRepository.findByIdWithDevices(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }
  assertWalletHardwareCapability(wallet, 'display');

  // Build wallet export data (uses device accounts for correct derivation paths)
  const walletData = buildWalletExportData(wallet);

  // Check if format exists
  if (!exportFormatRegistry.has(formatId)) {
    throw new InvalidInputError(`Unknown export format: ${formatId}. Use GET /export/formats to see available formats.`);
  }

  // Export using registry
  const result = exportFormatRegistry.export(formatId, walletData, {
    includeDevices: true,
    includeChangeDescriptor: true,
  });

  // Set appropriate headers for download
  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.content);
}));

export default router;
