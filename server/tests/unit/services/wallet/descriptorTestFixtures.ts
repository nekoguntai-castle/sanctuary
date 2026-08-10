import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../src/services/bitcoin/bip32';

type Network = typeof bitcoin.networks.bitcoin;

const account = (seedByte: number, path: string, network: Network) => {
  const root = bip32.fromSeed(Buffer.alloc(32, seedByte), network);
  return {
    fingerprint: Buffer.from(root.fingerprint).toString('hex'),
    path,
    xpub: root.derivePath(path).neutered().toBase58(),
  };
};

const descriptorKey = (
  signer: ReturnType<typeof account>,
  branch: 0 | 1,
): string => (
  `[${signer.fingerprint}/${signer.path.slice(2)}]${signer.xpub}/${branch}/*`
);

export const MAINNET_BIP84 = account(
  41,
  "m/84'/0'/0'",
  bitcoin.networks.bitcoin,
);

export const TESTNET_BIP84 = account(
  42,
  "m/84'/1'/0'",
  bitcoin.networks.testnet,
);

export const MAINNET_BIP48_SIGNERS = Object.freeze([
  account(51, "m/48'/0'/0'/2'", bitcoin.networks.bitcoin),
  account(52, "m/48'/0'/0'/2'", bitcoin.networks.bitcoin),
  account(53, "m/48'/0'/1'/2'", bitcoin.networks.bitcoin),
]);

export const MAINNET_BIP84_DESCRIPTORS = Object.freeze({
  receive: `wpkh(${descriptorKey(MAINNET_BIP84, 0)})`,
  change: `wpkh(${descriptorKey(MAINNET_BIP84, 1)})`,
  multipath: `wpkh([${MAINNET_BIP84.fingerprint}/${MAINNET_BIP84.path.slice(2)}]${MAINNET_BIP84.xpub}/<0;1>/*)`,
});

export const TESTNET_BIP84_DESCRIPTORS = Object.freeze({
  receive: `wpkh(${descriptorKey(TESTNET_BIP84, 0)})`,
  change: `wpkh(${descriptorKey(TESTNET_BIP84, 1)})`,
});

export const mainnetBip48Descriptors = (
  signers: readonly (typeof MAINNET_BIP48_SIGNERS)[number][] = MAINNET_BIP48_SIGNERS.slice(0, 2),
) => Object.freeze({
  receive: `wsh(sortedmulti(2,${signers.map(signer => descriptorKey(signer, 0)).join(',')}))`,
  change: `wsh(sortedmulti(2,${signers.map(signer => descriptorKey(signer, 1)).join(',')}))`,
});
