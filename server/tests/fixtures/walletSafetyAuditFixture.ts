import type { WalletSafetyRawSnapshot } from '../../src/services/walletSafetyAudit';

export const AUDIT_FIXTURE_XPUB = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
export const AUDIT_FIXTURE_RECEIVE = `wpkh([aabbccdd/84'/1'/0']${AUDIT_FIXTURE_XPUB}/0/*)`;
export const AUDIT_FIXTURE_CHANGE = `wpkh([aabbccdd/84'/1'/0']${AUDIT_FIXTURE_XPUB}/1/*)`;
export const AUDIT_FIXTURE_SOURCE = `wpkh([aabbccdd/84'/1'/0']${AUDIT_FIXTURE_XPUB}/<0;1>/*)`;

export function provenAuditSnapshot(): WalletSafetyRawSnapshot {
  return {
    wallets: [{
      id: 'audit-wallet-proven',
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      quorum: null,
      totalSigners: null,
      descriptor: AUDIT_FIXTURE_RECEIVE,
      changeDescriptor: AUDIT_FIXTURE_CHANGE,
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'imported_multipath',
      sourceDescriptor: AUDIT_FIXTURE_SOURCE,
      sourceChangeDescriptor: null,
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
      fingerprint: 'aabbccdd',
    }],
    addresses: [
      {
        id: 'audit-address-receive',
        walletId: 'audit-wallet-proven',
        address: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
        derivationPath: "m/84'/1'/0'/0/0",
        index: 0,
      },
      {
        id: 'audit-address-change',
        walletId: 'audit-wallet-proven',
        address: 'tb1q9u62588spffmq4dzjxsr5l297znf3z6j5p2688',
        derivationPath: "m/84'/1'/0'/1/0",
        index: 0,
      },
    ],
    signers: [{
      id: 'audit-signer-proven',
      walletId: 'audit-wallet-proven',
      deviceId: 'audit-device-proven',
      deviceAccountId: 'audit-account-proven',
      signerIndex: 0,
      signerBindingVersion: 1,
      signerFingerprint: 'aabbccdd',
      signerXpub: AUDIT_FIXTURE_XPUB,
      signerDerivationPath: "m/84'/1'/0'",
      signerPurpose: 'single_sig',
      signerScriptType: 'native_segwit',
      deviceType: 'trezor',
      deviceFingerprint: 'aabbccdd',
      deviceDerivationPath: "m/84'/1'/0'",
      deviceXpub: AUDIT_FIXTURE_XPUB,
      accountPurpose: 'single_sig',
      accountScriptType: 'native_segwit',
      accountDerivationPath: "m/84'/1'/0'",
      accountXpub: AUDIT_FIXTURE_XPUB,
    }],
  };
}

const MULTISIG_XPUBS = [
  'tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ',
  'tpubDFPtPArj4GzBEFHohegg1Xatrc1Fi9oSox5LzuSRX91miwQxuUrEpBxpvDRsmZYJKYFhgdK3UStsjC8JKXfUbMinjFqiEM4uNwzVaCaHpys',
  'tpubDEfobrrtptRTbKf4gysDhoabneABDTAcdj3Vbn4XwPsLE2pmqpizSPRG6zHsbAMuiSgWmWPsYCLHTKTPpyrGJ5rAoTpKoQNZcxodiPf2tSJ',
] as const;

function orderedMultisigDescriptor(branch: 0 | 1): string {
  const keys = MULTISIG_XPUBS.map(
    (xpub, index) => `[${['aabbccdd', 'eeff0011', '22334455'][index]}/48'/1'/0'/2']${xpub}/${branch}/*`,
  );
  return `wsh(multi(2,${keys.join(',')}))`;
}

export function recoverableOrderedMultisigSnapshot(): WalletSafetyRawSnapshot {
  const receive = orderedMultisigDescriptor(0);
  const change = orderedMultisigDescriptor(1);
  return {
    wallets: [{
      id: 'audit-wallet-ordered',
      type: 'multi_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      quorum: 2,
      totalSigners: 3,
      descriptor: receive,
      changeDescriptor: change,
      descriptorPolicyVersion: null,
      descriptorSourceKind: null,
      sourceDescriptor: receive,
      sourceChangeDescriptor: change,
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
      fingerprint: 'aabbccdd-eeff0011-22334455',
    }],
    addresses: [
      {
        id: 'audit-ordered-receive',
        walletId: 'audit-wallet-ordered',
        address: 'tb1qmv9kucx4tjtyfwddc3698p2flxqvts89n8kllr0hvdv7qs4z476s70nuf5',
        derivationPath: "m/48'/1'/0'/2'/0/0",
        index: 0,
      },
      {
        id: 'audit-ordered-change',
        walletId: 'audit-wallet-ordered',
        address: 'tb1qp58f8l2cmpl8wx5ms7gcr7zfamsspr47rn45j4z3v6drakeffk6q6ezllu',
        derivationPath: "m/48'/1'/0'/2'/1/0",
        index: 0,
      },
    ],
    signers: [],
  };
}
