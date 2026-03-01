/**
 * Descriptor Parser
 *
 * Parses Bitcoin output descriptor strings into structured ParsedDescriptor objects.
 * Handles single-sig and multisig descriptors.
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { removeChecksum } from './checksum';
import {
  detectScriptType,
  isMultisigDescriptor,
  extractKeyExpressions,
  parseKeyExpression,
  detectNetwork,
  isChangeDescriptor,
  extractQuorum,
} from './descriptorUtils';
import type { ParsedDevice, ParsedDescriptor, DescriptorParseError } from './types';

const log = createLogger('DESCRIPTOR');

/**
 * Parse a Bitcoin output descriptor and extract all relevant information
 */
export function parseDescriptorForImport(descriptor: string): ParsedDescriptor {
  // Clean up descriptor
  let cleanDescriptor = removeChecksum(descriptor.trim());
  log.debug('parseDescriptorForImport', { cleanDescriptor: cleanDescriptor.substring(0, 100), startsWithWsh: cleanDescriptor.toLowerCase().startsWith('wsh(') });

  // Detect script type
  const scriptType = detectScriptType(cleanDescriptor);

  // Detect if multisig
  const isMultisig = isMultisigDescriptor(cleanDescriptor);

  // Extract key expressions
  const keyExpressions = extractKeyExpressions(cleanDescriptor);

  if (keyExpressions.length === 0) {
    throw new Error('No valid key expressions found in descriptor');
  }

  // Parse each key expression into device info
  const devices: ParsedDevice[] = [];
  for (const expr of keyExpressions) {
    devices.push(parseKeyExpression(expr));
  }

  // Detect network from first device
  const network = detectNetwork(devices[0].xpub, devices[0].derivationPath);

  // Detect change chain
  const isChange = isChangeDescriptor(cleanDescriptor);

  // Build result
  const result: ParsedDescriptor = {
    type: isMultisig ? 'multi_sig' : 'single_sig',
    scriptType,
    devices,
    network,
    isChange,
  };

  if (isMultisig) {
    result.quorum = extractQuorum(cleanDescriptor);
    result.totalSigners = devices.length;
  }

  return result;
}

/**
 * Validate a descriptor string and return any errors
 */
export function validateDescriptor(descriptor: string): DescriptorParseError | null {
  try {
    parseDescriptorForImport(descriptor);
    return null;
  } catch (error) {
    return {
      message: getErrorMessage(error, 'Invalid descriptor'),
    };
  }
}

/**
 * Extract descriptor from text that may contain comments
 * Returns the first valid descriptor line found
 */
export function extractDescriptorFromText(input: string): string | null {
  const lines = input.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check if line looks like a descriptor (starts with script type wrapper)
    if (
      trimmed.startsWith('wsh(') ||
      trimmed.startsWith('wpkh(') ||
      trimmed.startsWith('sh(') ||
      trimmed.startsWith('pkh(') ||
      trimmed.startsWith('tr(')
    ) {
      return trimmed;
    }
  }

  return null;
}

/**
 * Check if input is a text file with descriptors and comments
 */
export function isDescriptorTextFormat(input: string): boolean {
  const lines = input.split('\n');
  let hasComment = false;
  let hasDescriptor = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) hasComment = true;
    if (
      trimmed.startsWith('wsh(') ||
      trimmed.startsWith('wpkh(') ||
      trimmed.startsWith('sh(') ||
      trimmed.startsWith('pkh(') ||
      trimmed.startsWith('tr(')
    ) {
      hasDescriptor = true;
    }
  }

  return hasComment && hasDescriptor;
}
