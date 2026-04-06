/**
 * Wallet Export JSON Format Handler
 *
 * Handles JSON exports with a descriptor field (e.g., from Sparrow).
 * Format: { descriptor: "...", label?: "...", ... }
 */

import type { ImportFormatHandler, FormatDetectionResult, ImportParseResult } from '../types';
import { parseDescriptorForImport } from '../../bitcoin/descriptorParser';
import { WalletExportDetectionSchema } from '../schemas';

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

    try {
      const json = JSON.parse(trimmed);
      const result = WalletExportDetectionSchema.safeParse(json);

      if (result.success) {
        // High confidence if it has descriptor and other expected fields
        const hasLabel = 'label' in json || 'name' in json;
        const hasKeystores = 'keystores' in json;
        const confidence = 80 + (hasLabel ? 5 : 0) + (hasKeystores ? 10 : 0);
        return { detected: true, confidence };
      }

      return { detected: false, confidence: 0 };
    } catch {
      return { detected: false, confidence: 0 };
    }
  },

  parse(input: string): ImportParseResult {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(input.trim());
    } catch {
      throw new Error('Invalid JSON in wallet export input');
    }
    const parsed = parseDescriptorForImport(json.descriptor as string);

    return {
      parsed,
      suggestedName: (json.label || json.name) as string | undefined,
    };
  },

  extractName(input: string): string | undefined {
    try {
      const json = JSON.parse(input.trim());
      return json.label || json.name;
    } catch {
      return undefined;
    }
  },
};
