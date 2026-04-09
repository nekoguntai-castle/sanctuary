/**
 * Wallet Export JSON Format Handler
 *
 * Handles JSON exports with a descriptor field (e.g., from Sparrow).
 * Format: { descriptor: "...", label?: "...", ... }
 */

import type { ImportFormatHandler, FormatDetectionResult, ImportParseResult } from '../types';
import { parseDescriptorForImport } from '../../bitcoin/descriptorParser';
import { WalletExportDetectionSchema } from '../schemas';
import { createLogger } from '../../../utils/logger';
import { safeJsonParseUntyped } from '../../../utils/safeJson';

const log = createLogger('IMPORT:WALLET_EXPORT');

export const walletExportHandler: ImportFormatHandler = {
  id: 'wallet_export',
  name: 'Wallet Export (Sparrow)',
  description: 'JSON export with descriptor field (Sparrow, Specter, etc.)',
  priority: 80,
  fileExtensions: ['.json'],

  canHandle(input: string): FormatDetectionResult {
    const trimmed = input.trim();

    // Must be JSON
    if (!trimmed.startsWith('{')) {
      return { detected: false, confidence: 0 };
    }

    const json = safeJsonParseUntyped<Record<string, unknown> | null>(trimmed, null, 'wallet export detection');
    if (!json) {
      return { detected: false, confidence: 0 };
    }

    const result = WalletExportDetectionSchema.safeParse(json);
    if (result.success) {
      // High confidence if it has descriptor and other expected fields
      const hasLabel = 'label' in json || 'name' in json;
      const hasKeystores = 'keystores' in json;
      const confidence = 80 + (hasLabel ? 5 : 0) + (hasKeystores ? 10 : 0);
      return { detected: true, confidence };
    }

    return { detected: false, confidence: 0 };
  },

  parse(input: string): ImportParseResult {
    const json = safeJsonParseUntyped<Record<string, unknown> | null>(input.trim(), null, 'wallet export parse');
    if (!json || typeof json.descriptor !== 'string') {
      throw new Error('Invalid JSON in wallet export input');
    }
    const parsed = parseDescriptorForImport(json.descriptor);

    return {
      parsed,
      suggestedName: (json.label || json.name) as string | undefined,
    };
  },

  extractName(input: string): string | undefined {
    const json = safeJsonParseUntyped<Record<string, unknown> | null>(input.trim(), null, 'wallet export name extraction');
    if (!json) return undefined;
    return (json.label || json.name) as string | undefined;
  },
};
