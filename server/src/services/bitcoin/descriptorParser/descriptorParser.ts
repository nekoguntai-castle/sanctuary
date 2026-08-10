/**
 * Descriptor Parser
 *
 * Parses Bitcoin output descriptor strings into structured ParsedDescriptor objects.
 * Handles single-sig and multisig descriptors.
 */

import { WalletType } from '@sanctuary/shared/constants/walletIdentity';
import { WALLET_POLICY_REGISTRY } from '@sanctuary/shared/constants/walletPolicy';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { parseCanonicalDescriptor } from './canonicalDescriptor';
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
  const canonical = parseCanonicalDescriptor(descriptor);
  log.debug('parseDescriptorForImport', {
    descriptorLength: canonical.body.length,
    wrapper: canonical.wrapper,
  });
  const isMultisig = canonical.threshold !== undefined;
  const policy = WALLET_POLICY_REGISTRY.find(
    row => row.descriptorWrapper === canonical.wrapper,
  );
  if (!policy) throw new Error('Descriptor wrapper has no canonical wallet policy');
  const devices: ParsedDevice[] = canonical.keys.map(key => ({
    fingerprint: key.fingerprint,
    xpub: key.xpub,
    derivationPath: key.accountPath,
  }));
  const result: ParsedDescriptor = {
    type: isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG,
    scriptType: policy.scriptType,
    devices,
    network: canonical.network === 'mainnet' ? 'mainnet' : 'testnet',
    isChange: canonical.suffix.kind === 'branch' && canonical.suffix.branch === 1,
  };

  if (isMultisig) {
    result.quorum = canonical.threshold;
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
  // A direct single-token API value is byte-exact evidence. Only invoke the
  // line-oriented recovery-text extractor for actual multi-line input; using
  // it for a single padded token would silently trim the submitted evidence.
  const extracted = isDescriptorTextFormat(input) ? extractDescriptorPairFromText(input) : null;
  const source = extracted ?? {
    receiveDescriptor: input,
  };
  if (
    source.changeDescriptor
    && explicitChangeDescriptor
    && source.changeDescriptor !== explicitChangeDescriptor
  ) {
    throw new Error('Embedded and supplied change descriptors do not match exactly');
  }
  return {
    receiveDescriptor: source.receiveDescriptor,
    ...(explicitChangeDescriptor || source.changeDescriptor
      ? { changeDescriptor: explicitChangeDescriptor ?? source.changeDescriptor }
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
