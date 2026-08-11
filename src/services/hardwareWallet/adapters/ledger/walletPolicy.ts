import type { AppClient, DefaultWalletPolicy } from '@ledgerhq/ledger-bitcoin';
import { DefaultWalletPolicy as LedgerDefaultWalletPolicy } from '@ledgerhq/ledger-bitcoin';
import { parseCanonicalAccountPath, parseCanonicalAddressPath } from '@sanctuary/shared/constants/walletPolicy';
import { normalizeMasterFingerprint } from '../../identity';
import { getDescriptorTemplate } from './utils';

export interface LedgerDefaultPolicy {
  accountPath: string;
  accountXpub: string;
  fingerprint: string;
  policy: DefaultWalletPolicy;
}

const LEDGER_SCRIPT_TYPES = {
  legacy: 'p2pkh',
  nested_segwit: 'p2sh-p2wpkh',
  native_segwit: 'p2wpkh',
  taproot: 'p2tr',
} as const;

function ledgerScriptType(scriptType: string) {
  if (!Object.hasOwn(LEDGER_SCRIPT_TYPES, scriptType)) {
    throw new Error(`Unsupported Ledger wallet policy script type: ${scriptType}`);
  }
  return LEDGER_SCRIPT_TYPES[scriptType as keyof typeof LEDGER_SCRIPT_TYPES];
}

export function requireLedgerAccountPath(path: string) {
  const parsed = parseCanonicalAccountPath(path);
  if (!parsed || parsed.policy.walletType !== 'single_sig') {
    throw new Error(`Ledger account export requires a canonical single-signature account path; received ${path}`);
  }
  return parsed;
}

export async function buildLedgerDefaultPolicy(
  appClient: AppClient,
  accountPath: string,
  expectedFingerprint?: string,
  expectedXpub?: string,
): Promise<LedgerDefaultPolicy> {
  const parsed = requireLedgerAccountPath(accountPath);
  const fingerprint = normalizeMasterFingerprint(await appClient.getMasterFingerprint(), 'Ledger');
  if (expectedFingerprint && fingerprint !== normalizeMasterFingerprint(expectedFingerprint, 'wallet')) {
    throw new Error('Connected Ledger master fingerprint does not match the wallet-selected signer');
  }
  const accountXpub = await appClient.getExtendedPubkey(accountPath, false);
  if (!accountXpub) throw new Error(`Ledger returned an empty account xpub for ${accountPath}`);
  if (expectedXpub && accountXpub !== expectedXpub) {
    throw new Error('Connected Ledger account xpub does not match the wallet-selected account');
  }
  const descriptorTemplate = getDescriptorTemplate(ledgerScriptType(parsed.policy.scriptType));
  const key = `[${fingerprint}/${accountPath.replace(/^m\//, '')}]${accountXpub}`;
  return {
    accountPath,
    accountXpub,
    fingerprint,
    policy: new LedgerDefaultWalletPolicy(descriptorTemplate, key),
  };
}

export function requireLedgerAddressPath(path: string) {
  const parsed = parseCanonicalAddressPath(path);
  if (!parsed || parsed.policy.walletType !== 'single_sig') {
    throw new Error(`Ledger address display requires a canonical single-signature path; received ${path}`);
  }
  return parsed;
}
