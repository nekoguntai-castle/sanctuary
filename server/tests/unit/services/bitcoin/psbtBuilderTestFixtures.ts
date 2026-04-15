import type { MultisigKeyInfo } from '../../../../src/services/bitcoin/addressDerivation';

// Verified-good deterministic BIP48 test xpubs at m/48'/1'/0'/2'.
export const testMultisigKeys: MultisigKeyInfo[] = [
  {
    fingerprint: '01ef24b4',
    accountPath: "48'/1'/0'/2'",
    xpub: 'tpubDFVykm8BAr81EooDYzRXphJC6Z28HKji4iJFopTrMH8wXnxn1WVkx29rP1wCAPmFV8huHhhzXJBhRJFtyuvrtBD5NAevCxes3AGLaQNVFCK',
    derivationPath: '0/*',
  },
  {
    fingerprint: '315ebe52',
    accountPath: "48'/1'/0'/2'",
    xpub: 'tpubDELwCusfNrWrYvRp9aquUwkDpxtzdPruvKTRi1ojCaQASdsK2716zTBTGB464yMLRREf2hhxQsCMBVr9LBjQNYFt1ME7A4vJYL52XV7zbGY',
    derivationPath: '0/*',
  },
  {
    fingerprint: '6648bb48',
    accountPath: "48'/1'/0'/2'",
    xpub: 'tpubDFThhNWT71SDtGQcBFTNSgHcf82LPZZi9hErv3pYSsubcxyx1qpB3AE29Eng3ZXS1a7GAdjiodJYNDysqa8gvQuUgqNveG2T3Gbg3HwhoRG',
    derivationPath: '0/*',
  },
];
