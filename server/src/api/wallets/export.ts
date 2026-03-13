/**
 * Wallets - Export Router
 *
 * Wallet export in various formats (BIP 329, Sparrow, etc.)
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { walletRepository, transactionRepository, addressRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { exportFormatRegistry, type WalletExportData } from '../../services/export';

const router = Router();
const log = createLogger('WALLETS:EXPORT');

/**
 * Build wallet export data from wallet with devices
 * Selects the appropriate device account based on wallet type
 */
function buildWalletExportData(wallet: NonNullable<Awaited<ReturnType<typeof walletRepository.findByIdWithDevices>>>): WalletExportData {
  // Determine expected purpose based on wallet type
  const expectedPurpose = wallet.type === 'multi_sig' ? 'multisig' : 'single_sig';

  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type === 'multi_sig' ? 'multi_sig' : 'single_sig',
    scriptType: wallet.scriptType as any,
    network: wallet.network as any,
    descriptor: wallet.descriptor || '',
    quorum: wallet.quorum || undefined,
    totalSigners: wallet.totalSigners || undefined,
    devices: wallet.devices.map((wd) => {
      // Find the appropriate account based on wallet type
      // Priority: exact match (purpose + scriptType) > purpose match > legacy fields
      const accounts = (wd.device as any).accounts || [];
      const exactMatch = accounts.find(
        (a: any) => a.purpose === expectedPurpose && a.scriptType === wallet.scriptType
      );
      const purposeMatch = accounts.find((a: any) => a.purpose === expectedPurpose);
      const account = exactMatch || purposeMatch;

      return {
        label: wd.device.label,
        type: wd.device.type,
        fingerprint: wd.device.fingerprint,
        // Use account-specific xpub and derivation path if available
        xpub: account?.xpub || wd.device.xpub,
        derivationPath: account?.derivationPath || wd.device.derivationPath || undefined,
      };
    }),
    createdAt: wallet.createdAt,
  };
}

/**
 * Map device type to Sparrow wallet model
 */
export function mapDeviceTypeToWalletModel(deviceType: string): string {
  const typeMap: Record<string, string> = {
    'coldcard': 'COLDCARD',
    'coldcardmk4': 'COLDCARD',
    'coldcard_mk4': 'COLDCARD',
    'coldcard_q': 'COLDCARD',
    'ledger': 'LEDGER_NANO_S',
    'ledger_nano': 'LEDGER_NANO_S',
    'ledger_nano_s': 'LEDGER_NANO_S',
    'ledger_nano_x': 'LEDGER_NANO_X',
    'ledger_stax': 'LEDGER_STAX',
    'ledger_flex': 'LEDGER_FLEX',
    'ledger_gen_5': 'LEDGER_FLEX', // Gen 5 uses same protocol as Flex
    'trezor': 'TREZOR_1',
    'trezor_one': 'TREZOR_1',
    'trezor_model_t': 'TREZOR_T',
    'trezor_safe_3': 'TREZOR_SAFE_3',
    'trezor_safe_7': 'TREZOR_SAFE_5', // Safe 7 uses Safe 5 protocol
    'bitbox02': 'BITBOX_02',
    'bitbox': 'BITBOX_02',
    'foundation_passport': 'PASSPORT',
    'passport': 'PASSPORT',
    'blockstream_jade': 'JADE',
    'jade': 'JADE',
    'keystone': 'KEYSTONE',
    'generic': 'AIRGAPPED',
    'generic_sd': 'AIRGAPPED',
  };

  const normalized = deviceType.toLowerCase().replace(/\s+/g, '_');
  // Return mapped value or uppercase device type (never SPARROW for hardware wallets)
  return typeMap[normalized] || deviceType.toUpperCase().replace(/\s+/g, '_');
}

/**
 * GET /api/v1/wallets/:id/export/labels
 * Export wallet labels in BIP 329 format (JSON Lines)
 * https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki
 */
router.get('/:id/export/labels', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    // Get wallet name for filename
    const walletName = await walletRepository.getName(walletId);

    if (!walletName) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

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
  } catch (error) {
    log.error('Export labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to export labels',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/export/formats
 * Get available export formats for this wallet
 */
router.get('/:id/export/formats', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    // Get wallet to determine which formats are available
    const wallet = await walletRepository.findByIdWithDevices(walletId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

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
  } catch (error) {
    log.error('Get export formats error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get export formats',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/export
 * Export wallet in the specified format (default: sparrow)
 * Query params:
 *   format - Export format ID (sparrow, descriptor, bluewallet, coldcard)
 */
router.get('/:id/export', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const formatId = (req.query.format as string) || 'sparrow';

    // Get wallet with all related data
    const wallet = await walletRepository.findByIdWithDevices(walletId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Build wallet export data (uses device accounts for correct derivation paths)
    const walletData = buildWalletExportData(wallet);

    // Check if format exists
    if (!exportFormatRegistry.has(formatId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Unknown export format: ${formatId}. Use GET /export/formats to see available formats.`,
      });
    }

    // Export using registry
    try {
      const result = exportFormatRegistry.export(formatId, walletData, {
        includeDevices: true,
        includeChangeDescriptor: true,
      });

      // Set appropriate headers for download
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.content);
    } catch (exportError) {
      return res.status(400).json({
        error: 'Bad Request',
        message: exportError instanceof Error ? exportError.message : 'Failed to export wallet in the specified format',
      });
    }
  } catch (error) {
    log.error('Export wallet error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to export wallet',
    });
  }
});

export default router;
