import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import bip32 from '../../../../src/services/bitcoin/bip32';

bitcoin.initEccLib(ecc);

const mocks = vi.hoisted(() => ({
  findWallet: vi.fn(),
  findUtxos: vi.fn(),
  findAddresses: vi.fn(),
  assertCanonical: vi.fn(),
  parseDescriptor: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  walletRepository: { findByIdWithSigningDevices: mocks.findWallet },
  utxoRepository: { findByOutpointsForWallet: mocks.findUtxos },
  addressRepository: { findCanonicalEvidenceForPsbt: mocks.findAddresses },
}));

vi.mock('../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesMatchWallet: mocks.assertCanonical,
}));

vi.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  convertToStandardXpub: (value: string) => value,
  parseDescriptor: mocks.parseDescriptor,
}));

vi.mock('../../../../src/services/bitcoin/psbtBuilder', () => ({
  buildMultisigWitnessScript: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/utils', () => ({
  getNetwork: () => bitcoin.networks.testnet,
}));

import { bindPsbtAccount } from '../../../../src/services/bitcoin/psbtAccountBinding';

const network = bitcoin.networks.testnet;
const fingerprint = 'aabbccdd';
const signerAccountPath = "m/86'/1'/7'";
const signerNode = bip32.fromSeed(Buffer.alloc(32, 86), network)
  .deriveHardened(86).deriveHardened(1).deriveHardened(7).neutered();
const signerXpub = signerNode.toBase58();

function parseTaprootDescriptor(value: string) {
  const match = value.match(/tr\(\[([0-9a-f]{8})\/([^\]]+)]([^/,)]+)\/(0|1)\/\*\)/);
  if (!match) throw new Error('invalid Taproot test descriptor');
  return {
    type: 'tr',
    fingerprint: match[1],
    accountPath: `m/${match[2]}`,
    xpub: match[3],
    derivationPath: `${match[4]}/*`,
    path: `${match[4]}/*`,
  };
}

function addressEvidence(branch: 0 | 1) {
  const internalPubkey = Buffer.from(signerNode.derive(branch).derive(0).publicKey)
    .subarray(1, 33);
  const payment = bitcoin.payments.p2tr({ internalPubkey, network });
  return {
    id: `taproot-${branch}`,
    walletId: 'wallet-1',
    address: payment.address!,
    derivationPath: `${signerAccountPath}/${branch}/0`,
    index: 0,
    branch,
    coordinateVersion: 1,
    canonicalPolicyId: 'single-sig-taproot-bip86-v1',
    canonicalPolicyVersion: 1,
    scriptPubKey: Buffer.from(payment.output!).toString('hex'),
    used: false,
    createdAt: new Date(),
    internalPubkey,
  };
}

function taprootWallet(receiveDescriptor: string, changeDescriptor: string) {
  return {
    id: 'wallet-1',
    type: 'single_sig',
    scriptType: 'taproot',
    network: 'testnet3',
    descriptor: receiveDescriptor,
    changeDescriptor,
    canonicalPolicyId: 'single-sig-taproot-bip86-v1',
    canonicalPolicyVersion: 1,
    devices: [{
      deviceId: 'device-1',
      deviceAccountId: 'account-1',
      signerIndex: 0,
      signerBindingVersion: 1,
      signerFingerprint: fingerprint,
      signerXpub,
      signerDerivationPath: signerAccountPath,
      signerPurpose: 'single_sig',
      signerScriptType: 'taproot',
      device: { id: 'device-1' },
    }],
  };
}

function taprootFixture() {
  const receive = addressEvidence(0);
  const change = addressEvidence(1);
  const descriptorForBranch = (branch: 0 | 1) => (
    `tr([${fingerprint}/86'/1'/7']${signerXpub}/${branch}/*)`
  );
  const owned = {
    id: `${'88'.repeat(32)}:0`,
    walletId: 'wallet-1',
    txid: '88'.repeat(32),
    vout: 0,
    address: receive.address,
    amount: 20_000n,
    scriptPubKey: receive.scriptPubKey,
  };
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput({
    hash: owned.txid,
    index: 0,
    witnessUtxo: { script: Buffer.from(owned.scriptPubKey, 'hex'), value: owned.amount },
  });
  psbt.addOutput({ address: change.address, value: 19_000n });
  return {
    psbt,
    receive,
    change,
    owned,
    wallet: taprootWallet(descriptorForBranch(0), descriptorForBranch(1)),
  };
}

function arrangeTaprootBinding() {
  const value = taprootFixture();
  mocks.findWallet.mockResolvedValue(value.wallet);
  mocks.findUtxos.mockResolvedValue([value.owned]);
  mocks.findAddresses.mockResolvedValue([value.receive, value.change]);
  return value;
}

describe('bindPsbtAccount Taproot metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseDescriptor.mockImplementation(parseTaprootDescriptor);
  });

  it('binds exact Taproot key-path BIP371 input and change metadata', async () => {
    const value = arrangeTaprootBinding();

    const context = await bindPsbtAccount('wallet-1', value.psbt);

    expect(context.scriptType).toBe('taproot');
    expect(context.inputs[0].signerOrigins[0].pubkey).toHaveLength(64);
    expect(value.psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    expect(value.psbt.data.inputs[0].tapBip32Derivation?.[0].leafHashes).toEqual([]);
    expect(Buffer.from(value.psbt.data.inputs[0].tapInternalKey!))
      .toEqual(value.receive.internalPubkey);
    expect(Buffer.from(value.psbt.data.outputs[0].tapInternalKey!))
      .toEqual(value.change.internalPubkey);
  });

  it('accepts an already exact Taproot input and change without duplicate metadata', async () => {
    const value = arrangeTaprootBinding();
    await bindPsbtAccount('wallet-1', value.psbt);

    await expect(bindPsbtAccount('wallet-1', value.psbt)).resolves.toMatchObject({
      scriptType: 'taproot',
    });

    expect(value.psbt.data.inputs[0].tapBip32Derivation).toHaveLength(1);
    expect(value.psbt.data.outputs[0].tapBip32Derivation).toHaveLength(1);
  });

  it('rejects a persisted Taproot multisig wallet before descriptor or account binding', async () => {
    const value = taprootFixture();
    mocks.findWallet.mockResolvedValue({
      ...value.wallet,
      type: 'multi_sig',
    });

    await expect(bindPsbtAccount('wallet-1', value.psbt))
      .rejects.toThrow('Taproot multisig is not supported');
    expect(mocks.parseDescriptor).not.toHaveBeenCalled();
    expect(mocks.findUtxos).not.toHaveBeenCalled();
    expect(mocks.findAddresses).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong internal key', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapInternalKey = Buffer.alloc(32, 9);
    }, 'conflicting tapInternalKey'],
    ['nonempty leaf hashes', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapBip32Derivation![0].leafHashes = [Buffer.alloc(32, 1)];
    }, 'conflicting Taproot derivation'],
    ['legacy derivation mixing', (psbt: bitcoin.Psbt) => {
      const tap = psbt.data.inputs[0].tapBip32Derivation![0];
      psbt.data.inputs[0].bip32Derivation = [{
        masterFingerprint: tap.masterFingerprint,
        path: tap.path,
        pubkey: Buffer.concat([Buffer.from([2]), Buffer.from(tap.pubkey)]),
      }];
    }, 'mixes Taproot and legacy'],
    ['script-path merkle root', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapMerkleRoot = Buffer.alloc(32, 2);
    }, 'script-path metadata'],
    ['output script-path tree', (psbt: bitcoin.Psbt) => {
      psbt.data.outputs[0].tapTree = {
        leaves: [{ depth: 0, leafVersion: 0xc0, script: Buffer.of(0x51) }],
      };
    }, 'script-path metadata'],
  ])('rejects Taproot %s', async (_label, mutate, expected) => {
    const value = arrangeTaprootBinding();
    await bindPsbtAccount('wallet-1', value.psbt);
    mutate(value.psbt);
    await expect(bindPsbtAccount('wallet-1', value.psbt)).rejects.toThrow(expected);
  });
});
