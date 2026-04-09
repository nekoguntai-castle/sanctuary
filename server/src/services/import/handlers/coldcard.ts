/**
 * Coldcard JSON Export Format Handler
 *
 * Handles JSON exports from Coldcard hardware wallets.
 * These contain xfp (fingerprint) and multiple BIP paths.
 */

import type { ImportFormatHandler, FormatDetectionResult, ImportParseResult } from '../types';
import { parseColdcardExport } from '../../bitcoin/descriptorParser';
import { ColdcardDetectionSchema } from '../schemas';
import { createLogger } from '../../../utils/logger';
import { safeJsonParseUntyped } from '../../../utils/safeJson';

const log = createLogger('IMPORT:COLDCARD');

export const coldcardHandler: ImportFormatHandler = {
  id: 'coldcard',
  name: 'Coldcard Export',
  description: 'JSON export from Coldcard hardware wallet',
  priority: 85,
  fileExtensions: ['.json'],

  canHandle(input: string): FormatDetectionResult {
    const trimmed = input.trim();

    // Must be JSON
    if (!trimmed.startsWith('{')) {
      return { detected: false, confidence: 0 };
    }

    const json = safeJsonParseUntyped<Record<string, unknown> | null>(trimmed, null, 'coldcard detection');
    if (!json) {
      return { detected: false, confidence: 0 };
    }

    const result = ColdcardDetectionSchema.safeParse(json);
    if (result.success) {
      // High confidence if it has the expected Coldcard structure
      // Nested format (standard single-sig export)
      const hasNestedPaths =
        json.bip84 || json.bip48_2 || json.bip49 || json.bip44;
      // Flat format (generic multisig export)
      const hasFlatPaths =
        json.p2wsh || json.p2sh_p2wsh || json.p2sh;
      return {
        detected: true,
        confidence: (hasNestedPaths || hasFlatPaths) ? 95 : 85,
      };
    }

    return { detected: false, confidence: 0 };
  },

  parse(input: string): ImportParseResult {
    const json = safeJsonParseUntyped<Record<string, unknown> | null>(input.trim(), null, 'coldcard export parse');
    if (!json) {
      throw new Error('Invalid JSON in Coldcard export input');
    }
    const { parsed, availablePaths } = parseColdcardExport(json as unknown as Parameters<typeof parseColdcardExport>[0]);

    return {
      parsed,
      availablePaths,
      suggestedName: (json.name || json.label) as string | undefined,
    };
  },

  extractName(input: string): string | undefined {
    const json = safeJsonParseUntyped<Record<string, unknown> | null>(input.trim(), null, 'coldcard name extraction');
    if (!json) return undefined;
    return (json.name || json.label) as string | undefined;
  },
};
