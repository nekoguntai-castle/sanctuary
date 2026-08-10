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

import { parseCanonicalDescriptor } from '../descriptorParser/canonicalDescriptor';
import type { ParsedDescriptor } from './types';

const TYPE_BY_WRAPPER = {
  pkh: 'pkh',
  'sh(wpkh)': 'sh-wpkh',
  wpkh: 'wpkh',
  tr: 'tr',
  'sh(wsh(sortedmulti))': 'sh-wsh-sortedmulti',
  'wsh(sortedmulti)': 'wsh-sortedmulti',
} as const satisfies Record<string, ParsedDescriptor['type']>;

const suffixText = (suffix: ReturnType<typeof parseCanonicalDescriptor>['suffix']): string => (
  suffix.kind === 'multipath' ? '<0;1>/*' : `${suffix.branch}/*`
);

/**
 * Parse output descriptor to extract xpub and derivation info
 */
export function parseDescriptor(descriptor: string): ParsedDescriptor {
  const canonical = parseCanonicalDescriptor(descriptor);
  const type = TYPE_BY_WRAPPER[canonical.wrapper];
  if (canonical.threshold !== undefined) {
    return {
      type,
      quorum: canonical.threshold,
      keys: canonical.keys.map(key => ({
        fingerprint: key.fingerprint,
        accountPath: key.accountPath,
        xpub: key.xpub,
        derivationPath: suffixText(key.suffix),
      })),
    };
  }
  const key = canonical.keys[0];
  return {
    type,
    xpub: key.xpub,
    path: suffixText(key.suffix),
    fingerprint: key.fingerprint,
    accountPath: key.accountPath,
  };
}
