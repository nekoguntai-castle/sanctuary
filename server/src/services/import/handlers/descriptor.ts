/**
 * Plain Descriptor Format Handler
 *
 * Handles raw Bitcoin output descriptors (BIP-380/381/386).
 * This is the fallback handler with lowest priority.
 */

import type { ImportFormatHandler, FormatDetectionResult, ImportParseResult } from '../types';
import {
  parseDescriptorForImport,
  isDescriptorTextFormat,
  resolveDescriptorTextPair,
} from '../../bitcoin/descriptorParser';

/**
 * Regex patterns for descriptor detection
 */
const DESCRIPTOR_PREFIXES = /^(wpkh|wsh|sh|pkh|tr|multi|sortedmulti|pk)\s*\(/i;
const DESCRIPTOR_WITH_COMMENTS = /^\s*(#.*\n)*\s*(wpkh|wsh|sh|pkh|tr|multi|sortedmulti)\s*\(/im;

export const descriptorHandler: ImportFormatHandler = {
  id: 'descriptor',
  name: 'Bitcoin Descriptor',
  description: 'Raw Bitcoin output descriptor (BIP-380/381/386)',
  priority: 10, // Lowest priority - fallback handler
  fileExtensions: ['.txt'],

  canHandle(input: string): FormatDetectionResult {
    const trimmed = input.trim();

    // Don't handle JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return { detected: false, confidence: 0 };
    }

    // Check for direct descriptor
    if (DESCRIPTOR_PREFIXES.test(trimmed)) {
      return { detected: true, confidence: 90 };
    }

    // Check for descriptor with comments (text file format)
    if (isDescriptorTextFormat(trimmed)) {
      return { detected: true, confidence: 70 };
    }

    // Check for descriptor pattern anywhere
    if (DESCRIPTOR_WITH_COMMENTS.test(trimmed)) {
      return { detected: true, confidence: 60 };
    }

    // Low confidence fallback - try to parse anything
    return { detected: true, confidence: 5 };
  },

  parse(input: string): ImportParseResult {
    const trimmed = input.trim();

    // Try to extract descriptor from text format
    if (isDescriptorTextFormat(trimmed)) {
      const pair = resolveDescriptorTextPair(trimmed);
      return {
        parsed: parseDescriptorForImport(pair.receiveDescriptor),
      };
    }

    // Parse as plain descriptor
    return {
      parsed: parseDescriptorForImport(trimmed),
    };
  },
};
