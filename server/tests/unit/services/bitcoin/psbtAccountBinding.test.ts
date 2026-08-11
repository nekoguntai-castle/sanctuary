import { createHash } from 'node:crypto';
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
  buildWitness: vi.fn(),
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
  buildMultisigWitnessScript: mocks.buildWitness,
}));

vi.mock('../../../../src/services/bitcoin/utils', () => ({
  getNetwork: () => bitcoin.networks.testnet,
}));

import { bindPsbtAccount } from '../../../../src/services/bitcoin/psbtAccountBinding';

const network = bitcoin.networks.testnet;
const fingerprint = 'aabbccdd';
const accountPath = "m/84'/1'/0'";
const accountNode = bip32.fromSeed(Buffer.alloc(32, 7), network)
  .deriveHardened(84).deriveHardened(1).deriveHardened(0).neutered();
const accountXpub = accountNode.toBase58();
const descriptor = `wpkh([${fingerprint}/84'/1'/0']${accountXpub}/0/*)`;
const changeDescriptor = `wpkh([${fingerprint}/84'/1'/0']${accountXpub}/1/*)`;

function evidence(branch: 0 | 1, index: number) {
  const child = accountNode.derive(branch).derive(index);
  const payment = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network });
  return {
    id: `address-${branch}-${index}`,
    walletId: 'wallet-1',
    address: payment.address!,
    derivationPath: `${accountPath}/${branch}/${index}`,
    index,
    branch,
    coordinateVersion: 1,
    canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
    scriptPubKey: Buffer.from(payment.output!).toString('hex'),
    used: false,
    createdAt: new Date(),
  };
}

const receive0 = evidence(0, 0);
const receive1 = evidence(0, 1);
const change0 = evidence(1, 0);

function parseTestDescriptor(value: string) {
  const keys = [...value.matchAll(/\[([0-9a-f]{8})\/([^\]]+)]([^/,)]+)\/(0|1)\/\*/g)]
    .map(match => ({
      fingerprint: match[1], accountPath: `m/${match[2]}`,
      xpub: match[3], derivationPath: `${match[4]}/*`,
    }));
  if (keys.length > 1) {
    return {
      type: value.startsWith('sh(') ? 'sh-wsh-sortedmulti' : 'wsh-sortedmulti',
      quorum: 2,
      keys,
    };
  }
  if (keys.length !== 1) throw new Error('invalid test descriptor');
  return {
    type: value.startsWith('tr(') ? 'tr' : 'wpkh',
    ...keys[0], path: keys[0].derivationPath,
  };
}

function singleSigFixture(scriptType: 'legacy' | 'nested_segwit') {
  const purpose = scriptType === 'legacy' ? 44 : 49;
  const signerAccountPath = `m/${purpose}'/1'/0'`;
  const signerNode = bip32.fromSeed(Buffer.alloc(32, purpose), network)
    .deriveHardened(purpose).deriveHardened(1).deriveHardened(0).neutered();
  const signerXpub = signerNode.toBase58();
  const makeEvidence = (branch: 0 | 1) => {
    const pubkey = signerNode.derive(branch).derive(0).publicKey;
    const witness = bitcoin.payments.p2wpkh({ pubkey, network });
    const payment = scriptType === 'legacy'
      ? bitcoin.payments.p2pkh({ pubkey, network })
      : bitcoin.payments.p2sh({ redeem: witness, network });
    return {
      id: `${scriptType}-${branch}`, walletId: 'wallet-1', address: payment.address!,
      derivationPath: `${signerAccountPath}/${branch}/0`, index: 0, branch,
      coordinateVersion: 1,
      canonicalPolicyId: `single-sig-${scriptType}-test-v1`, canonicalPolicyVersion: 1,
      scriptPubKey: Buffer.from(payment.output!).toString('hex'), used: false, createdAt: new Date(),
      redeemScript: scriptType === 'nested_segwit' ? Buffer.from(witness.output!) : undefined,
    };
  };
  const receive = makeEvidence(0);
  const change = makeEvidence(1);
  const descriptorForBranch = (branch: 0 | 1) => {
    const key = `[${fingerprint}/${purpose}'/1'/0']${signerXpub}/${branch}/*`;
    return scriptType === 'legacy' ? `pkh(${key})` : `sh(wpkh(${key}))`;
  };
  const boundWallet = wallet({
    scriptType,
    descriptor: descriptorForBranch(0),
    changeDescriptor: descriptorForBranch(1),
    canonicalPolicyId: receive.canonicalPolicyId,
    devices: [{
      ...wallet().devices[0], signerXpub, signerDerivationPath: signerAccountPath,
      signerScriptType: scriptType,
    }],
  });
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32), 0xffffffff);
  previous.addOutput(Buffer.from(receive.scriptPubKey, 'hex'), 20_000n);
  const txid = scriptType === 'legacy' ? previous.getId() : '66'.repeat(32);
  const owned = {
    id: `${txid}:0`, walletId: 'wallet-1', txid, vout: 0,
    address: receive.address, amount: 20_000n, scriptPubKey: receive.scriptPubKey,
  };
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput({
    hash: owned.txid, index: owned.vout,
    ...(scriptType === 'legacy'
      ? { nonWitnessUtxo: previous.toBuffer() }
      : { witnessUtxo: { script: Buffer.from(owned.scriptPubKey, 'hex'), value: owned.amount } }),
  });
  psbt.addOutput({ address: change.address, value: 19_000n });
  return { psbt, boundWallet, receive, change, owned };
}

function multisigFixture(nested: boolean) {
  const scriptBranch = nested ? 1 : 2;
  const multisigAccountPath = `m/48'/1'/0'/${scriptBranch}'`;
  const nodes = [8, 9].map(seed => bip32.fromSeed(Buffer.alloc(32, seed), network)
    .deriveHardened(48).deriveHardened(1).deriveHardened(0)
    .deriveHardened(scriptBranch).neutered());
  const fingerprints = ['11223344', '55667788'];
  const key = (index: number, branch: 0 | 1) =>
    `[${fingerprints[index]}/48'/1'/0'/${scriptBranch}']${nodes[index].toBase58()}/${branch}/*`;
  const wrap = (branch: 0 | 1) => {
    const sorted = `wsh(sortedmulti(2,${key(0, branch)},${key(1, branch)}))`;
    return nested ? `sh(${sorted})` : sorted;
  };
  const addressEvidence = (branch: 0 | 1) => {
    const pubkeys = nodes.map(node => node.derive(branch).derive(0).publicKey)
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    const witnessScript = bitcoin.payments.p2ms({ m: 2, pubkeys, network }).output!;
    const witness = bitcoin.payments.p2wsh({ redeem: { output: witnessScript }, network });
    const payment = nested ? bitcoin.payments.p2sh({ redeem: witness, network }) : witness;
    return {
      id: `multi-${nested}-${branch}`, walletId: 'wallet-1', address: payment.address!,
      derivationPath: `${multisigAccountPath}/${branch}/0`, index: 0, branch,
      coordinateVersion: 1, canonicalPolicyId: nested
        ? 'multi-sig-nested-segwit-bip48-v1' : 'multi-sig-native-segwit-bip48-v1',
      canonicalPolicyVersion: 1,
      scriptPubKey: Buffer.from(payment.output!).toString('hex'), used: false, createdAt: new Date(),
      witnessScript: Buffer.from(witnessScript),
      redeemScript: nested ? Buffer.from(witness.output!) : undefined,
    };
  };
  const receive = addressEvidence(0);
  const change = addressEvidence(1);
  const devices = nodes.map((node, signerIndex) => ({
    deviceId: `device-${signerIndex}`,
    deviceAccountId: `account-${signerIndex}`,
    signerIndex,
    signerBindingVersion: 1,
    signerFingerprint: fingerprints[signerIndex],
    signerXpub: node.toBase58(),
    signerDerivationPath: multisigAccountPath,
    signerPurpose: 'multisig',
    signerScriptType: nested ? 'nested_segwit' : 'native_segwit',
    device: { id: `device-${signerIndex}` },
  }));
  const boundWallet = wallet({
    type: 'multi_sig', scriptType: nested ? 'nested_segwit' : 'native_segwit',
    descriptor: wrap(0), changeDescriptor: wrap(1), devices,
    canonicalPolicyId: receive.canonicalPolicyId,
  });
  const owned = utxo('77'.repeat(32), 0, receive as typeof receive0);
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput({
    hash: owned.txid, index: 0,
    witnessUtxo: { script: Buffer.from(owned.scriptPubKey, 'hex'), value: owned.amount },
  });
  psbt.addOutput({ address: change.address, value: 19_000n });
  return { psbt, boundWallet, devices, receive, change, owned };
}

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-1',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: 'testnet3',
    descriptor,
    changeDescriptor,
    canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
    devices: [{
      deviceId: 'device-1',
      deviceAccountId: 'account-1',
      signerIndex: 0,
      signerBindingVersion: 1,
      signerFingerprint: fingerprint,
      signerXpub: accountXpub,
      signerDerivationPath: accountPath,
      signerPurpose: 'single_sig',
      signerScriptType: 'native_segwit',
      device: { id: 'device-1' },
    }],
    ...overrides,
  };
}

function utxo(txid: string, vout: number, address: typeof receive0) {
  return {
    id: `${txid}:${vout}`,
    walletId: 'wallet-1',
    txid,
    vout,
    address: address.address,
    amount: 20_000n,
    scriptPubKey: address.scriptPubKey,
  };
}

function fixture() {
  const first = utxo('11'.repeat(32), 0, receive0);
  const second = utxo('22'.repeat(32), 1, receive1);
  const psbt = new bitcoin.Psbt({ network });
  for (const item of [first, second]) {
    psbt.addInput({
      hash: item.txid,
      index: item.vout,
      witnessUtxo: { script: Buffer.from(item.scriptPubKey, 'hex'), value: item.amount },
    });
  }
  psbt.addOutput({ address: change0.address, value: 39_000n });
  return { psbt, first, second };
}

describe('bindPsbtAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseDescriptor.mockImplementation(parseTestDescriptor);
    mocks.buildWitness.mockImplementation((path: string, keys: Array<{ xpub: string }>, quorum: number) => {
      const parts = path.split('/');
      const branch = Number(parts.at(-2));
      const index = Number(parts.at(-1));
      const pubkeys = keys.map(key => bip32.fromBase58(key.xpub, network)
        .derive(branch).derive(index).publicKey).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
      return bitcoin.payments.p2ms({ m: quorum, pubkeys, network }).output;
    });
    mocks.findWallet.mockResolvedValue(wallet());
    mocks.findAddresses.mockResolvedValue([receive0, receive1, change0]);
  });

  it('binds every owned input and exact branch-1 change metadata', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);

    const context = await bindPsbtAccount('wallet-1', psbt);

    expect(context.inputs.map(input => input.inputIndex)).toEqual([0, 1]);
    expect(context.changeOutputs.map(output => output.outputIndex)).toEqual([0]);
    expect(context.signers[0]).toMatchObject({
      deviceAccountId: 'account-1', masterFingerprint: fingerprint, accountXpub,
    });
    expect(psbt.data.inputs[0].bip32Derivation?.[0].path).toBe(`${accountPath}/0/0`);
    expect(psbt.data.inputs[1].bip32Derivation?.[0].path).toBe(`${accountPath}/0/1`);
    expect(psbt.data.outputs[0].bip32Derivation?.[0].path).toBe(`${accountPath}/1/0`);
  });

  it('bindPsbtAccount commits the exact descriptor pair to descriptorDigest', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);

    const context = await bindPsbtAccount('wallet-1', psbt);

    const expectedDigest = createHash('sha256')
      .update(JSON.stringify([descriptor, changeDescriptor]), 'utf8')
      .digest('hex');
    expect(context.descriptorDigest).toBe(expectedDigest);
  });

  it('accepts already-exact input and change metadata without appending duplicates', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    const derivation = (branch: 0 | 1, index: number) => ({
      masterFingerprint: Buffer.from(fingerprint, 'hex'),
      path: `${accountPath}/${branch}/${index}`,
      pubkey: accountNode.derive(branch).derive(index).publicKey,
    });
    psbt.updateInput(0, { bip32Derivation: [derivation(0, 0)] });
    psbt.updateInput(1, { bip32Derivation: [derivation(0, 1)] });
    psbt.updateOutput(0, { bip32Derivation: [derivation(1, 0)] });

    await expect(bindPsbtAccount('wallet-1', psbt)).resolves.toMatchObject({
      inputs: [{ inputIndex: 0 }, { inputIndex: 1 }],
      changeOutputs: [{ outputIndex: 0 }],
    });
    expect(psbt.data.inputs[0].bip32Derivation).toHaveLength(1);
    expect(psbt.data.outputs[0].bip32Derivation).toHaveLength(1);
  });

  it.each([
    ['tapBip32Derivation', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapBip32Derivation = [{
        masterFingerprint: Buffer.from(fingerprint, 'hex'), path: `${accountPath}/0/0`,
        pubkey: Buffer.alloc(32, 1), leafHashes: [],
      }];
    }],
    ['tapInternalKey', (psbt: bitcoin.Psbt) => { psbt.data.inputs[0].tapInternalKey = Buffer.alloc(32, 1); }],
    ['tapKeySig', (psbt: bitcoin.Psbt) => { psbt.data.inputs[0].tapKeySig = Buffer.alloc(64, 1); }],
    ['tapScriptSig', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapScriptSig = [{
        pubkey: Buffer.alloc(32, 1), leafHash: Buffer.alloc(32, 2), signature: Buffer.alloc(64, 3),
      }];
    }],
    ['tapLeafScript', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapLeafScript = [{
        controlBlock: Buffer.concat([Buffer.of(0xc0), Buffer.alloc(32, 1)]),
        leafVersion: 0xc0, script: Buffer.of(0x51),
      }];
    }],
    ['tapMerkleRoot', (psbt: bitcoin.Psbt) => { psbt.data.inputs[0].tapMerkleRoot = Buffer.alloc(32, 1); }],
  ])('rejects non-Taproot input field %s', async (_field, mutate) => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mutate(psbt);

    await expect(bindPsbtAccount('wallet-1', psbt))
      .rejects.toThrow('mixes non-Taproot and Taproot PSBT metadata');
  });

  it.each([
    ['tapBip32Derivation', (psbt: bitcoin.Psbt) => {
      psbt.data.outputs[0].tapBip32Derivation = [{
        masterFingerprint: Buffer.from(fingerprint, 'hex'), path: `${accountPath}/1/0`,
        pubkey: Buffer.alloc(32, 1), leafHashes: [],
      }];
    }],
    ['tapInternalKey', (psbt: bitcoin.Psbt) => { psbt.data.outputs[0].tapInternalKey = Buffer.alloc(32, 1); }],
    ['tapTree', (psbt: bitcoin.Psbt) => {
      psbt.data.outputs[0].tapTree = {
        leaves: [{ depth: 0, leafVersion: 0xc0, script: Buffer.of(0x51) }],
      };
    }],
  ])('rejects non-Taproot output field %s', async (_field, mutate) => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mutate(psbt);

    await expect(bindPsbtAccount('wallet-1', psbt))
      .rejects.toThrow('mixes non-Taproot and Taproot PSBT metadata');
  });

  it('rejects a conflicting derivation on the second input', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    psbt.updateInput(1, {
      bip32Derivation: [{
        masterFingerprint: Buffer.from(fingerprint, 'hex'),
        path: `${accountPath}/0/99`,
        pubkey: accountNode.derive(0).derive(99).publicKey,
      }],
    });

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'input 1 has conflicting BIP32 derivation metadata',
    );
  });

  it('rejects a conflicting derivation on a branch-1 change output', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    psbt.updateOutput(0, {
      bip32Derivation: [{
        masterFingerprint: Buffer.from(fingerprint, 'hex'),
        path: `${accountPath}/0/0`,
        pubkey: accountNode.derive(0).derive(0).publicKey,
      }],
    });
    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'output 0 has conflicting BIP32 derivation metadata',
    );
  });

  it('rejects when any ordinary input is absent from wallet ownership evidence', async () => {
    const { psbt, first } = fixture();
    mocks.findUtxos.mockResolvedValue([first]);
    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'input 1 is not an owned wallet UTXO',
    );
  });

  it('rejects a UTXO script that does not match canonical address evidence', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([{ ...first, scriptPubKey: '0014' + '00'.repeat(20) }, second]);
    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'input 0 prevout does not match canonical wallet evidence',
    );
  });

  it('bindPsbtAccount rejects a wallet UTXO amount that differs from the authenticated prevout', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([{ ...first, amount: first.amount + 1n }, second]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'input 0 prevout does not match canonical wallet evidence',
    );
  });

  it('rejects incomplete immutable signer snapshots', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mocks.findWallet.mockResolvedValue(wallet({
      devices: [{ ...wallet().devices[0], signerFingerprint: null }],
    }));
    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow('signer snapshot 0 is incomplete');
  });

  it('rejects a signer snapshot whose account xpub differs from the descriptor', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mocks.findWallet.mockResolvedValue(wallet({
      devices: [{ ...wallet().devices[0], signerXpub: accountNode.derive(7).neutered().toBase58() }],
    }));
    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'signer snapshot 0 does not match the descriptor pair',
    );
  });

  it('allows an explicitly foreign Payjoin input but still binds every owned input', async () => {
    const { psbt, first } = fixture();
    mocks.findUtxos.mockResolvedValue([first]);
    const context = await bindPsbtAccount('wallet-1', psbt, { foreignInputIndexes: [1] });
    expect(context.inputs.map(input => input.inputIndex)).toEqual([0]);
    expect(psbt.data.inputs[1].bip32Derivation).toBeUndefined();
  });

  it.each([false, true])(
    'binds complete sortedmulti origins and exact native/nested scripts (nested=%s)',
    async nested => {
      const fixture = multisigFixture(nested);
      mocks.findWallet.mockResolvedValue(fixture.boundWallet);
      mocks.findUtxos.mockResolvedValue([fixture.owned]);
      mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
      const context = await bindPsbtAccount('wallet-1', fixture.psbt);
      expect(context.signers.map(signer => signer.signerIndex)).toEqual([0, 1]);
      expect(context.inputs[0].signerOrigins).toHaveLength(2);
      expect(fixture.psbt.data.inputs[0].bip32Derivation).toHaveLength(2);
      expect(Buffer.from(fixture.psbt.data.inputs[0].witnessScript!))
        .toEqual(fixture.receive.witnessScript);
      expect(Buffer.from(fixture.psbt.data.outputs[0].witnessScript!))
        .toEqual(fixture.change.witnessScript);
      if (nested) {
        expect(Buffer.from(fixture.psbt.data.inputs[0].redeemScript!))
          .toEqual(fixture.receive.redeemScript);
        expect(Buffer.from(fixture.psbt.data.outputs[0].redeemScript!))
          .toEqual(fixture.change.redeemScript);
      }
    },
  );

  it('accepts exact multisig derivations in a different array order', async () => {
    const fixture = multisigFixture(false);
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    const derivations = (branch: 0 | 1) => fixture.devices.map(device => ({
      masterFingerprint: Buffer.from(device.signerFingerprint, 'hex'),
      path: `${device.signerDerivationPath}/${branch}/0`,
      pubkey: bip32.fromBase58(device.signerXpub, network).derive(branch).derive(0).publicKey,
    })).reverse();
    fixture.psbt.updateInput(0, {
      bip32Derivation: derivations(0),
      witnessScript: fixture.receive.witnessScript,
    });
    fixture.psbt.updateOutput(0, {
      bip32Derivation: derivations(1),
      witnessScript: fixture.change.witnessScript,
    });

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).resolves.toMatchObject({
      inputs: [{ inputIndex: 0 }],
      changeOutputs: [{ outputIndex: 0 }],
    });
  });

  it('bindPsbtAccount rejects one drifted origin in an otherwise complete multisig derivation array', async () => {
    const fixture = multisigFixture(false);
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    const derivations = fixture.devices.map(device => ({
      masterFingerprint: Buffer.from(device.signerFingerprint, 'hex'),
      path: `${device.signerDerivationPath}/0/0`,
      pubkey: bip32.fromBase58(device.signerXpub, network).derive(0).derive(0).publicKey,
    }));
    derivations[1] = { ...derivations[1], path: `${fixture.devices[1].signerDerivationPath}/0/1` };
    fixture.psbt.updateInput(0, {
      bip32Derivation: derivations,
      witnessScript: fixture.receive.witnessScript,
    });

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'input 0 has conflicting BIP32 derivation metadata',
    );
  });

  it('rejects multisig signer snapshot order and account-path drift', async () => {
    const fixture = multisigFixture(false);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    mocks.findWallet.mockResolvedValue({
      ...fixture.boundWallet,
      devices: [...fixture.devices].reverse(),
    });
    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'signer snapshot 0 is incomplete',
    );

    mocks.findWallet.mockResolvedValue({
      ...fixture.boundWallet,
      devices: fixture.devices.map((device, index) => index === 1
        ? { ...device, signerDerivationPath: "m/48'/1'/9'/2'" }
        : device),
    });
    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'signer snapshot 1 does not match the descriptor pair',
    );
  });

  it('rejects a nonWitnessUtxo whose transaction id differs from the input outpoint', async () => {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(Buffer.from(receive0.scriptPubKey, 'hex'), 20_000n);
    const claimedTxid = '33'.repeat(32);
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({ hash: claimedTxid, index: 0, nonWitnessUtxo: previous.toBuffer() });
    psbt.addOutput({ address: change0.address, value: 19_000n });
    mocks.findUtxos.mockResolvedValue([utxo(claimedTxid, 0, receive0)]);
    mocks.findAddresses.mockResolvedValue([receive0, change0]);
    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'nonWitnessUtxo transaction id does not match its outpoint',
    );
  });

  it('rejects conflicting witnessUtxo and authenticated nonWitnessUtxo evidence', async () => {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(Buffer.from(receive0.scriptPubKey, 'hex'), 21_000n);
    const txid = previous.getId();
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({
      hash: txid,
      index: 0,
      witnessUtxo: { script: Buffer.from(receive0.scriptPubKey, 'hex'), value: 20_000n },
      nonWitnessUtxo: previous.toBuffer(),
    });
    psbt.addOutput({ address: change0.address, value: 19_000n });
    mocks.findUtxos.mockResolvedValue([utxo(txid, 0, receive0)]);
    mocks.findAddresses.mockResolvedValue([receive0, change0]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'witnessUtxo does not match its nonWitnessUtxo',
    );
  });

  it('rejects a missing wallet before inspecting the PSBT', async () => {
    const { psbt } = fixture();
    mocks.findWallet.mockResolvedValue(null);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow('wallet not found');
    expect(mocks.findUtxos).not.toHaveBeenCalled();
  });

  it.each([
    ['wallet type', { type: 'unknown' }],
    ['script type', { scriptType: 'unknown' }],
    ['receive descriptor', { descriptor: null }],
    ['change descriptor', { changeDescriptor: null }],
  ])('rejects incomplete descriptor identity: %s', async (_label, overrides) => {
    const { psbt } = fixture();
    mocks.findWallet.mockResolvedValue(wallet(overrides));

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'wallet descriptor identity is incomplete',
    );
  });

  it.each([
    ['policy id', { canonicalPolicyId: null }],
    ['policy version', { canonicalPolicyVersion: null }],
  ])('rejects incomplete canonical policy identity: %s', async (_label, overrides) => {
    const { psbt } = fixture();
    mocks.findWallet.mockResolvedValue(wallet(overrides));

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'wallet canonical policy identity is incomplete',
    );
  });

  it('rejects a Taproot descriptor without a complete signer origin', async () => {
    const { psbt } = fixture();
    mocks.parseDescriptor.mockReturnValueOnce({ type: 'tr' });

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'descriptor signer origin is incomplete',
    );
  });

  it('rejects a descriptor without a complete signer origin', async () => {
    const { psbt } = fixture();
    mocks.parseDescriptor.mockReturnValueOnce({ type: 'wpkh', xpub: accountXpub });

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'descriptor signer origin is incomplete',
    );
  });

  it('accepts complete signer origins when the descriptor parser omits its optional suffix', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mocks.parseDescriptor.mockImplementation(value => {
      const parsed = parseTestDescriptor(value);
      if (!('path' in parsed)) throw new Error('expected a single-sig descriptor');
      const { path: _path, ...origin } = parsed;
      return origin;
    });

    await expect(bindPsbtAccount('wallet-1', psbt)).resolves.toMatchObject({
      inputs: [{ inputIndex: 0 }, { inputIndex: 1 }],
    });
  });

  it('rejects signer counts that differ from the descriptor pair', async () => {
    const { psbt } = fixture();
    mocks.findWallet.mockResolvedValue(wallet({ devices: [] }));

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'signer count does not match the descriptor pair',
    );
  });

  it('rejects receive and change descriptors with different signer counts', async () => {
    const fixture = multisigFixture(false);
    mocks.findWallet.mockResolvedValue({
      ...fixture.boundWallet,
      changeDescriptor,
    });

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'signer count does not match the descriptor pair',
    );
  });

  it.each([
    ['binding version', { signerBindingVersion: 0 }],
    ['signer index', { signerIndex: 1 }],
    ['device account', { deviceAccountId: null }],
    ['account xpub', { signerXpub: null }],
    ['account path', { signerDerivationPath: null }],
  ])('rejects an incomplete immutable signer snapshot: %s', async (_label, linkOverride) => {
    const { psbt } = fixture();
    mocks.findWallet.mockResolvedValue(wallet({
      devices: [{ ...wallet().devices[0], ...linkOverride }],
    }));

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'signer snapshot 0 is incomplete',
    );
  });

  it.each([
    ['outside the account', `${accountPath.replace("/0'", "/9'")}/0/0`, 'outside signer account'],
    ['a hardened child', `${accountPath}/0/0'`, 'hardened or invalid child'],
  ])('rejects an address path %s', async (_label, derivationPath, message) => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mocks.findAddresses.mockResolvedValue([{ ...receive0, derivationPath }, receive1, change0]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(message);
  });

  it.each(['legacy', 'nested_segwit'] as const)(
    'binds complete input and change metadata for %s single-sig',
    async scriptType => {
      const fixture = singleSigFixture(scriptType);
      mocks.findWallet.mockResolvedValue(fixture.boundWallet);
      mocks.findUtxos.mockResolvedValue([fixture.owned]);
      mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);

      const context = await bindPsbtAccount('wallet-1', fixture.psbt);

      expect(context.scriptType).toBe(scriptType);
      expect(context.inputs).toHaveLength(1);
      expect(context.changeOutputs).toHaveLength(1);
      if (scriptType === 'nested_segwit') {
        expect(Buffer.from(fixture.psbt.data.inputs[0].redeemScript!))
          .toEqual(fixture.receive.redeemScript);
        expect(Buffer.from(fixture.psbt.data.outputs[0].redeemScript!))
          .toEqual(fixture.change.redeemScript);
      } else {
        expect(fixture.psbt.data.inputs[0].redeemScript).toBeUndefined();
      }
    },
  );

  it('rejects a multisig policy with a non-SegWit script family', async () => {
    const fixture = multisigFixture(false);
    mocks.findWallet.mockResolvedValue({ ...fixture.boundWallet, scriptType: 'legacy' });
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'unsupported multisig script type',
    );
  });

  it('rejects multisig descriptor evidence without a quorum', async () => {
    const fixture = multisigFixture(false);
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    mocks.parseDescriptor
      .mockImplementationOnce(parseTestDescriptor)
      .mockImplementationOnce(parseTestDescriptor)
      .mockImplementationOnce(value => ({ ...parseTestDescriptor(value), quorum: undefined }));

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'multisig descriptor is incomplete',
    );
  });

  it('rejects a multisig witnessScript that cannot be derived', async () => {
    const fixture = multisigFixture(false);
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    mocks.buildWitness.mockReturnValue(undefined);

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'multisig witnessScript derivation failed',
    );
  });

  it('rejects pre-existing redeemScript metadata on a legacy input', async () => {
    const fixture = singleSigFixture('legacy');
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    fixture.psbt.updateInput(0, { redeemScript: Buffer.from('51', 'hex') });

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'input 0 has a conflicting redeemScript',
    );
  });

  it('rejects witness-only previous-output evidence for a legacy input', async () => {
    const fixture = singleSigFixture('legacy');
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    const unsafePsbt = new bitcoin.Psbt({ network });
    unsafePsbt.addInput({
      hash: fixture.owned.txid,
      index: fixture.owned.vout,
      witnessUtxo: {
        script: Buffer.from(fixture.owned.scriptPubKey, 'hex'),
        value: fixture.owned.amount,
      },
    });
    unsafePsbt.addOutput({ address: fixture.change.address, value: 19_000n });

    await expect(bindPsbtAccount('wallet-1', unsafePsbt)).rejects.toThrow(
      'legacy input 0 requires an authenticated nonWitnessUtxo',
    );
  });

  it('rejects a conflicting multisig witnessScript on change', async () => {
    const fixture = multisigFixture(false);
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    fixture.psbt.updateOutput(0, { witnessScript: Buffer.from('51', 'hex') });

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'output 0 has a conflicting witnessScript',
    );
  });

  it('rejects a wrong pre-existing redeemScript for nested SegWit', async () => {
    const fixture = singleSigFixture('nested_segwit');
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    fixture.psbt.updateInput(0, { redeemScript: Buffer.from('51', 'hex') });

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'input 0 has a conflicting redeemScript',
    );
  });

  it('rejects incomplete multisig derivation arrays', async () => {
    const fixture = multisigFixture(false);
    mocks.findWallet.mockResolvedValue(fixture.boundWallet);
    mocks.findUtxos.mockResolvedValue([fixture.owned]);
    mocks.findAddresses.mockResolvedValue([fixture.receive, fixture.change]);
    const firstSigner = fixture.devices[0];
    fixture.psbt.updateInput(0, {
      bip32Derivation: [{
        masterFingerprint: Buffer.from(firstSigner.signerFingerprint, 'hex'),
        path: `${firstSigner.signerDerivationPath}/0/0`,
        pubkey: bip32.fromBase58(firstSigner.signerXpub, network).derive(0).derive(0).publicKey,
      }],
    });

    await expect(bindPsbtAccount('wallet-1', fixture.psbt)).rejects.toThrow(
      'input 0 has conflicting BIP32 derivation metadata',
    );
  });

  it('rejects a nonWitnessUtxo whose referenced output is missing', async () => {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(Buffer.from(receive0.scriptPubKey, 'hex'), 20_000n);
    const txid = previous.getId();
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({ hash: txid, index: 1, nonWitnessUtxo: previous.toBuffer() });
    psbt.addOutput({ address: change0.address, value: 19_000n });
    mocks.findUtxos.mockResolvedValue([utxo(txid, 1, receive0)]);
    mocks.findAddresses.mockResolvedValue([receive0, change0]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow('input 0 prevout is missing');
  });

  it('rejects an input without witness or non-witness prevout evidence', async () => {
    const owned = utxo('44'.repeat(32), 0, receive0);
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({ hash: owned.txid, index: owned.vout });
    psbt.addOutput({ address: change0.address, value: 19_000n });
    mocks.findUtxos.mockResolvedValue([owned]);
    mocks.findAddresses.mockResolvedValue([receive0, change0]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'input 0 has no authenticated prevout',
    );
  });

  it('rejects witness and non-witness prevouts with equal values but different scripts', async () => {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(Buffer.from(receive0.scriptPubKey, 'hex'), 20_000n);
    const txid = previous.getId();
    const psbt = new bitcoin.Psbt({ network });
    psbt.addInput({
      hash: txid,
      index: 0,
      witnessUtxo: { script: Buffer.from(receive1.scriptPubKey, 'hex'), value: 20_000n },
      nonWitnessUtxo: previous.toBuffer(),
    });
    psbt.addOutput({ address: change0.address, value: 19_000n });
    mocks.findUtxos.mockResolvedValue([utxo(txid, 0, receive0)]);
    mocks.findAddresses.mockResolvedValue([receive0, change0]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'witnessUtxo does not match its nonWitnessUtxo',
    );
  });

  it('rejects canonical input evidence whose derivation produces another script', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mocks.findAddresses.mockResolvedValue([
      { ...receive0, derivationPath: receive1.derivationPath }, receive1, change0,
    ]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'input 0 script does not match signer keys',
    );
  });

  it('rejects a branch-1 change claim whose derivation does not produce its script', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mocks.findAddresses.mockResolvedValue([
      receive0, receive1, { ...change0, derivationPath: `${accountPath}/1/9` },
    ]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'change output 0 script does not match signer keys',
    );
  });

  it.each([-1, 2])('rejects foreign input index %s outside the PSBT', async foreignIndex => {
    const { psbt } = fixture();

    await expect(bindPsbtAccount('wallet-1', psbt, {
      foreignInputIndexes: [foreignIndex],
    })).rejects.toThrow('foreign input index is outside the PSBT');
    expect(mocks.findUtxos).not.toHaveBeenCalled();
  });

  it('rejects a wallet UTXO without canonical address evidence', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mocks.findAddresses.mockResolvedValue([receive1, change0]);

    await expect(bindPsbtAccount('wallet-1', psbt)).rejects.toThrow(
      'input 0 lacks canonical address evidence',
    );
  });

  it('rejects a PSBT where every input is declared foreign', async () => {
    const { psbt } = fixture();
    mocks.findUtxos.mockResolvedValue([]);
    mocks.findAddresses.mockResolvedValue([change0]);

    await expect(bindPsbtAccount('wallet-1', psbt, {
      foreignInputIndexes: [0, 1],
    })).rejects.toThrow('PSBT has no wallet-owned inputs');
  });

  it('does not claim an external output as change', async () => {
    const { psbt, first, second } = fixture();
    mocks.findUtxos.mockResolvedValue([first, second]);
    mocks.findAddresses.mockResolvedValue([receive0, receive1]);

    const context = await bindPsbtAccount('wallet-1', psbt);

    expect(context.changeOutputs).toEqual([]);
    expect(psbt.data.outputs[0].bip32Derivation).toBeUndefined();
  });
});
