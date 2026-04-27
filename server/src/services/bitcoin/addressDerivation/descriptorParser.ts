/**
 * Descriptor Parser
 *
 * Parses Bitcoin output descriptors to extract xpub, derivation info,
 * and multisig configuration. Supports various descriptor formats:
 * - wpkh([fingerprint/84'/0'/0']xpub.../0/*)
 * - sh(wpkh([fingerprint/49'/0'/0']xpub.../0/*))
 * - tr([fingerprint/86'/0'/0']xpub.../0/*)
 * - wsh(sortedmulti(M,[fp/path]xpub/0/*,[fp/path]xpub/0/*,...))
 * - sh(wsh(sortedmulti(...)))
 */

import type { ParsedDescriptor, MultisigKeyInfo } from './types';

const DEFAULT_DERIVATION_PATH = '0/*';
const SINGLE_SIG_PREFIX_TYPES: Array<{ prefix: string; type: ParsedDescriptor['type'] }> = [
  { prefix: 'wpkh(', type: 'wpkh' },
  { prefix: 'sh(wpkh(', type: 'sh-wpkh' },
  { prefix: 'tr(', type: 'tr' },
  { prefix: 'pkh(', type: 'pkh' },
];

const isDerivationPathCharacter = (character: string): boolean => {
  return character === '/' || character === '*' || (character >= '0' && character <= '9');
};

const extractDerivationPathAfterXpub = (
  descriptor: string,
  xpubStart: number,
  xpub: string
): string => {
  const pathStart = xpubStart + xpub.length;
  if (descriptor[pathStart] !== '/') {
    return DEFAULT_DERIVATION_PATH;
  }

  let pathEnd = pathStart + 1;
  while (pathEnd < descriptor.length && isDerivationPathCharacter(descriptor[pathEnd])) {
    pathEnd += 1;
  }

  const path = descriptor.slice(pathStart + 1, pathEnd);
  return path.length > 0 ? path : DEFAULT_DERIVATION_PATH;
};

const detectSingleSigDescriptorType = (descriptor: string): ParsedDescriptor['type'] => {
  const matched = SINGLE_SIG_PREFIX_TYPES.find(({ prefix }) => descriptor.startsWith(prefix));
  if (!matched) {
    throw new Error('Unsupported descriptor format');
  }
  return matched.type;
};

const parseMultisigDescriptor = (
  descriptor: string,
  type: 'wsh-sortedmulti' | 'sh-wsh-sortedmulti'
): ParsedDescriptor => {
  // Extract quorum (the M in M-of-N)
  const quorumMatch = descriptor.match(/(?:sorted)?multi\((\d+),/);
  if (!quorumMatch) {
    throw new Error('Could not parse quorum from multisig descriptor');
  }
  const quorum = parseInt(quorumMatch[1], 10);

  const keys: MultisigKeyInfo[] = [];

  // First try to match full format with fingerprint: [fingerprint/path]xpub/derivation
  // Note: fingerprint can be uppercase or lowercase hex
  const fullKeyRegex = /\[([a-fA-F0-9]{8})\/([^\]]+)\]([xyztuvYZTUV]pub[a-zA-Z0-9]+)(?:\/([0-9/*<>;]+))?/g;

  let match;
  while ((match = fullKeyRegex.exec(descriptor)) !== null) {
    keys.push({
      fingerprint: match[1],
      accountPath: match[2],
      xpub: match[3],
      derivationPath: match[4] || '0/*',
    });
  }

  // If no keys found with full format, try bare xpub format: xpub/derivation
  // This is simpler format without fingerprint wrapper
  if (keys.length === 0) {
    const bareKeyRegex = /([xyztuvYZTUV]pub[a-zA-Z0-9]+)(?:\/([0-9/*<>;]+))?/g;

    while ((match = bareKeyRegex.exec(descriptor)) !== null) {
      keys.push({
        fingerprint: '00000000', // Unknown fingerprint
        accountPath: "m/unknown'",
        xpub: match[1],
        derivationPath: match[2] || '0/*',
      });
    }
  }

  if (keys.length === 0) {
    throw new Error('Could not parse keys from multisig descriptor');
  }

  return {
    type,
    quorum,
    keys,
  };
};

/**
 * Parse output descriptor to extract xpub and derivation info
 */
export function parseDescriptor(descriptor: string): ParsedDescriptor {
  const trimmedDescriptor = descriptor.trim();

  if (trimmedDescriptor.startsWith('wsh(sortedmulti(') || trimmedDescriptor.startsWith('wsh(multi(')) {
    return parseMultisigDescriptor(trimmedDescriptor, 'wsh-sortedmulti');
  }
  if (trimmedDescriptor.startsWith('sh(wsh(sortedmulti(') || trimmedDescriptor.startsWith('sh(wsh(multi(')) {
    return parseMultisigDescriptor(trimmedDescriptor, 'sh-wsh-sortedmulti');
  }

  const type = detectSingleSigDescriptorType(trimmedDescriptor);
  const keyExpressionMatch = /\[([a-f0-9]{8})\/([^\]]+)\]([xyztuvYZTUV]pub[a-zA-Z0-9]+)/.exec(trimmedDescriptor);

  if (!keyExpressionMatch) {
    const simpleMatch = /([xyztuvYZTUV]pub[a-zA-Z0-9]+)/.exec(trimmedDescriptor);
    if (!simpleMatch) {
      throw new Error('Could not parse xpub from descriptor');
    }

    return {
      type,
      xpub: simpleMatch[1],
      path: extractDerivationPathAfterXpub(trimmedDescriptor, simpleMatch.index, simpleMatch[1]),
    };
  }

  const [, fingerprint, accountPath, xpub] = keyExpressionMatch;
  const xpubStart = keyExpressionMatch.index + keyExpressionMatch[0].lastIndexOf(xpub);

  return {
    type,
    xpub,
    path: extractDerivationPathAfterXpub(trimmedDescriptor, xpubStart, xpub),
    fingerprint,
    accountPath,
  };
}
