/**
 * Descriptor Parser
 *
 * Parses Bitcoin output descriptor strings into structured ParsedDescriptor objects.
 * Handles single-sig and multisig descriptors.
 */

import { WalletType } from '@sanctuary/shared/constants/walletIdentity';
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
import {
  validateParsedDescriptorDomain,
  validateRawDescriptorDomain,
} from './domainValidation';
import type {
  ParsedDevice,
  ParsedDescriptor,
  DescriptorParseError,
  DescriptorTextPair,
} from './types';

const log = createLogger('BITCOIN:SVC_DESCRIPTOR');

/**
 * Parse a Bitcoin output descriptor and extract all relevant information
 */
export function parseDescriptorForImport(descriptor: string): ParsedDescriptor {
  // Clean up descriptor
  let cleanDescriptor = removeChecksum(descriptor.trim());
  log.debug('parseDescriptorForImport', {
    descriptorLength: cleanDescriptor.length,
    startsWithWsh: cleanDescriptor.toLowerCase().startsWith('wsh('),
  });
  validateRawDescriptorDomain(cleanDescriptor, 0);

  // Detect script type
  const scriptType = detectScriptType(cleanDescriptor);

  // Detect if multisig
  const isMultisig = isMultisigDescriptor(cleanDescriptor);

  // Extract key expressions
  const keyExpressions = extractKeyExpressions(cleanDescriptor);

  if (keyExpressions.length === 0) {
    throw new Error('No valid key expressions found in descriptor');
  }
  validateRawDescriptorDomain(cleanDescriptor, keyExpressions.length);

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
    type: isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG,
    scriptType,
    devices,
    network,
    isChange,
  };

  if (isMultisig) {
    result.quorum = extractQuorum(cleanDescriptor);
    result.totalSigners = devices.length;
  }

  validateParsedDescriptorDomain(result, {
    allowAccountRootPath: false,
    enforceScriptPurpose: true,
  });
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

type DescriptorTextSection = 'receive' | 'change';

const descriptorTextSection = (line: string): DescriptorTextSection | null => {
  if (/^#\s*Receive Descriptor\b/i.test(line)) return 'receive';
  if (/^#\s*Change Descriptor\b/i.test(line)) return 'change';
  return null;
};

const isDescriptorToken = (line: string): boolean =>
  /^(wsh|wpkh|sh|pkh|tr)\(/.test(line);

const descriptorSectionLabel = (section: DescriptorTextSection): string =>
  section === 'receive' ? 'Receive' : 'Change';

const unlabelledDescriptorPair = (descriptors: string[]): DescriptorTextPair | null => {
  if (descriptors.length === 0) return null;
  if (descriptors.length > 1) {
    throw new Error('Descriptor text contains multiple descriptors without receive/change labels');
  }
  return { receiveDescriptor: descriptors[0] };
};

const labelledDescriptorPair = (
  seenSections: Set<DescriptorTextSection>,
  descriptors: Partial<Record<DescriptorTextSection, string>>,
  unlabelledDescriptors: string[],
): DescriptorTextPair => {
  if (unlabelledDescriptors.length > 0) {
    throw new Error('Descriptor text contains a descriptor outside its receive/change section');
  }
  if (!seenSections.has('receive') || !descriptors.receive) {
    throw new Error('Receive descriptor section is missing a descriptor');
  }
  if (seenSections.has('change') && !descriptors.change) {
    throw new Error('Change descriptor section is missing a descriptor');
  }
  return {
    receiveDescriptor: descriptors.receive,
    ...(descriptors.change ? { changeDescriptor: descriptors.change } : {}),
  };
};

/**
 * Extract the exact descriptor token or explicitly labelled receive/change
 * pair from a plain-text recovery export. Multiple unlabelled descriptors are
 * ambiguous and therefore rejected rather than silently selecting the first.
 */
export function extractDescriptorPairFromText(input: string): DescriptorTextPair | null {
  let activeSection: DescriptorTextSection | null = null;
  let hasSectionLabels = false;
  const seenSections = new Set<DescriptorTextSection>();
  const descriptors: Partial<Record<DescriptorTextSection, string>> = {};
  const unlabelledDescriptors: string[] = [];

  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();
    const section = descriptorTextSection(line);
    if (section) {
      if (seenSections.has(section)) {
        throw new Error(`${descriptorSectionLabel(section)} descriptor section appears more than once`);
      }
      hasSectionLabels = true;
      seenSections.add(section);
      activeSection = section;
      continue;
    }
    if (!isDescriptorToken(line)) continue;

    if (!activeSection) {
      unlabelledDescriptors.push(line);
      continue;
    }
    if (descriptors[activeSection]) {
      throw new Error(`${descriptorSectionLabel(activeSection)} descriptor section contains multiple descriptors`);
    }
    descriptors[activeSection] = line;
  }

  return hasSectionLabels
    ? labelledDescriptorPair(seenSections, descriptors, unlabelledDescriptors)
    : unlabelledDescriptorPair(unlabelledDescriptors);
}

/** Resolve a raw token or recovery text export with an optional API-supplied change token. */
export function resolveDescriptorTextPair(
  input: string,
  explicitChangeDescriptor?: string,
): DescriptorTextPair {
  const extracted = extractDescriptorPairFromText(input) ?? {
    receiveDescriptor: input,
  };
  if (
    extracted.changeDescriptor
    && explicitChangeDescriptor
    && extracted.changeDescriptor !== explicitChangeDescriptor
  ) {
    throw new Error('Embedded and supplied change descriptors do not match exactly');
  }
  return {
    receiveDescriptor: extracted.receiveDescriptor,
    ...(explicitChangeDescriptor || extracted.changeDescriptor
      ? { changeDescriptor: explicitChangeDescriptor ?? extracted.changeDescriptor }
      : {}),
  };
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
