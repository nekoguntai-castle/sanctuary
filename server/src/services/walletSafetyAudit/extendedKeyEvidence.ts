import * as bitcoin from 'bitcoinjs-lib';
import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import bip32 from '../bitcoin/bip32';
import { convertToStandardXpub } from '../bitcoin/addressDerivation/xpubConversion';
import type { WalletAuditFindingId } from './schema';

interface ExtendedKeyEvidenceInput {
  xpub: string;
  fingerprint: string;
  derivationPath: string;
  walletNetwork: string;
  walletType: string;
  scriptType: string;
}

const VERSION_POLICIES = new Map<string, [string, string]>([
  ['ypub', ['single_sig', 'nested_segwit']],
  ['upub', ['single_sig', 'nested_segwit']],
  ['zpub', ['single_sig', 'native_segwit']],
  ['vpub', ['single_sig', 'native_segwit']],
  ['Ypub', ['multi_sig', 'nested_segwit']],
  ['Upub', ['multi_sig', 'nested_segwit']],
  ['Zpub', ['multi_sig', 'native_segwit']],
  ['Vpub', ['multi_sig', 'native_segwit']],
]);

function networkFamily(value: string): 'mainnet' | 'testnet' | null {
  if (value === 'mainnet') return 'mainnet';
  if (['testnet3', 'testnet4', 'testnet', 'signet', 'regtest'].includes(value)) return 'testnet';
  return null;
}

function xpubNetworkFamily(xpub: string): 'mainnet' | 'testnet' | null {
  if (/^(?:xpub|ypub|zpub|Ypub|Zpub)/.test(xpub)) return 'mainnet';
  if (/^(?:tpub|upub|vpub|Upub|Vpub)/.test(xpub)) return 'testnet';
  return null;
}

function versionMatchesPolicy(input: ExtendedKeyEvidenceInput): boolean {
  const prefix = input.xpub.slice(0, 4);
  if (prefix === 'xpub' || prefix === 'tpub') return true;
  const expected = VERSION_POLICIES.get(prefix);
  return expected?.[0] === input.walletType && expected[1] === input.scriptType;
}

function expectedDepth(derivationPath: string): number {
  return normalizeDerivationPath(derivationPath)
    .split('/')
    .filter((component) => component !== '' && component !== 'm')
    .length;
}

function parentFingerprint(value: number): string {
  return value.toString(16).padStart(8, '0').toLowerCase();
}

export function inspectExtendedKeyEvidence(
  input: ExtendedKeyEvidenceInput,
): WalletAuditFindingId[] {
  const findings = new Set<WalletAuditFindingId>();
  if (!/^[a-fA-F0-9]{8}$/.test(input.fingerprint) || input.fingerprint.toLowerCase() === '00000000') {
    findings.add('signer.fingerprint_missing');
  }

  const expectedFamily = networkFamily(input.walletNetwork);
  const actualFamily = xpubNetworkFamily(input.xpub);
  if (!expectedFamily || actualFamily !== expectedFamily) {
    findings.add('signer.xpub_network_mismatch');
    return [...findings];
  }
  if (!versionMatchesPolicy(input)) findings.add('signer.xpub_version_mismatch');

  try {
    const network = expectedFamily === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
    const node = bip32.fromBase58(convertToStandardXpub(input.xpub), network);
    if (node.depth !== expectedDepth(input.derivationPath)) {
      findings.add('signer.xpub_wrong_depth');
    }
    if (parentFingerprint(node.parentFingerprint) === input.fingerprint.toLowerCase()) {
      findings.add('signer.fingerprint_parent_only');
    }
  } catch {
    findings.add('signer.xpub_invalid');
  }
  return [...findings];
}
