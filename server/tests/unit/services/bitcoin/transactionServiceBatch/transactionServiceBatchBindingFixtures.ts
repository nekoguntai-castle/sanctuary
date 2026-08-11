import * as bitcoin from "bitcoinjs-lib";

import bip32 from "../../../../../src/services/bitcoin/bip32";
import { mockPrismaClient } from "../../../../mocks/prisma";
import { multisigKeyInfo } from "../../../../fixtures/bitcoin";

const network = bitcoin.networks.testnet;
const singleFingerprint = "aabbccdd";
const singleXpub =
  "tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M";

type ScriptType = "native_segwit" | "legacy";

type BatchAddress = {
  id: string;
  walletId: string;
  address: string;
  derivationPath: string;
  index: number;
  branch: 0 | 1;
  coordinateVersion: number;
  canonicalPolicyId: string;
  canonicalPolicyVersion: number;
  scriptPubKey: string;
  used: boolean;
};

type BatchUtxo = {
  id: string;
  walletId: string;
  txid: string;
  vout: number;
  amount: bigint;
  address: string;
  scriptPubKey: string;
  confirmations: number;
  spent: boolean;
  frozen: boolean;
};

export type BatchBindingFixture = {
  wallet: Record<string, unknown>;
  utxos: BatchUtxo[];
  inputAddresses: BatchAddress[];
  changeAddress: BatchAddress;
  rawTransactionHex?: string;
};

function singleSigPayment(
  accountNode: ReturnType<typeof bip32.fromBase58>,
  scriptType: ScriptType,
  branch: 0 | 1,
  index: number,
) {
  const pubkey = accountNode.derive(branch).derive(index).publicKey;
  return scriptType === "legacy"
    ? bitcoin.payments.p2pkh({ pubkey, network })
    : bitcoin.payments.p2wpkh({ pubkey, network });
}

function singleSigAddress(
  walletId: string,
  accountNode: ReturnType<typeof bip32.fromBase58>,
  scriptType: ScriptType,
  accountPath: string,
  policyId: string,
  branch: 0 | 1,
  index: number,
): BatchAddress {
  const payment = singleSigPayment(accountNode, scriptType, branch, index);
  return {
    id: `${walletId}-${branch}-${index}`,
    walletId,
    address: payment.address!,
    derivationPath: `${accountPath}/${branch}/${index}`,
    index,
    branch,
    coordinateVersion: 1,
    canonicalPolicyId: policyId,
    canonicalPolicyVersion: 1,
    scriptPubKey: Buffer.from(payment.output!).toString("hex"),
    used: branch === 0,
  };
}

function utxo(
  walletId: string,
  address: BatchAddress,
  txid: string,
  vout: number,
  amount: bigint,
): BatchUtxo {
  return {
    id: `${txid}:${vout}`,
    walletId,
    txid,
    vout,
    amount,
    address: address.address,
    scriptPubKey: address.scriptPubKey,
    confirmations: 100,
    spent: false,
    frozen: false,
  };
}

export function singleSigBatchFixture(
  walletId: string,
  scriptType: ScriptType = "native_segwit",
): BatchBindingFixture {
  const purpose = scriptType === "legacy" ? 44 : 84;
  const accountPath = `m/${purpose}'/1'/0'`;
  const wrapper = scriptType === "legacy" ? "pkh" : "wpkh";
  const policyId = scriptType === "legacy"
    ? "single-sig-legacy-bip44-v1"
    : "single-sig-native-segwit-bip84-v1";
  const accountNode = bip32.fromBase58(singleXpub, network);
  const descriptor = `${wrapper}([${singleFingerprint}/${purpose}'/1'/0']${singleXpub}/0/*)`;
  const changeDescriptor = `${wrapper}([${singleFingerprint}/${purpose}'/1'/0']${singleXpub}/1/*)`;
  const inputAddresses = [0, 1].map(index => singleSigAddress(
    walletId, accountNode, scriptType, accountPath, policyId, 0, index,
  ));
  const changeAddress = singleSigAddress(
    walletId, accountNode, scriptType, accountPath, policyId, 1, 0,
  );
  const deviceId = `${walletId}-device`;
  const utxos = [
    utxo(walletId, inputAddresses[0], "cc".repeat(32), 0, 200_000n),
    utxo(walletId, inputAddresses[1], "aa".repeat(32), 0, 100_000n),
  ];
  let rawTransactionHex: string | undefined;
  if (scriptType === "legacy") {
    const previous = new bitcoin.Transaction();
    previous.addInput(Buffer.alloc(32), 0xffffffff);
    previous.addOutput(Buffer.from(inputAddresses[0].scriptPubKey, "hex"), utxos[0].amount);
    utxos[0] = { ...utxos[0], id: `${previous.getId()}:0`, txid: previous.getId(), vout: 0 };
    rawTransactionHex = previous.toHex();
  }
  return {
    wallet: {
      id: walletId,
      name: "Bound batch wallet",
      type: "single_sig",
      scriptType,
      network: "testnet",
      descriptor,
      changeDescriptor,
      canonicalPolicyId: policyId,
      canonicalPolicyVersion: 1,
      fingerprint: singleFingerprint,
      quorum: null,
      totalSigners: null,
      devices: [{
        deviceId,
        deviceAccountId: `${deviceId}-account`,
        signerIndex: 0,
        signerBindingVersion: 1,
        signerFingerprint: singleFingerprint,
        signerXpub: singleXpub,
        signerDerivationPath: accountPath,
        signerPurpose: "single_sig",
        signerScriptType: scriptType,
        device: { id: deviceId, fingerprint: singleFingerprint, xpub: singleXpub },
      }],
    },
    utxos,
    inputAddresses,
    changeAddress,
    rawTransactionHex,
  };
}

function multisigAddress(
  walletId: string,
  nodes: Array<ReturnType<typeof bip32.fromBase58>>,
  accountPath: string,
  policyId: string,
  nested: boolean,
  branch: 0 | 1,
  index: number,
): BatchAddress {
  const pubkeys = nodes.map(node => node.derive(branch).derive(index).publicKey)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const witnessScript = bitcoin.payments.p2ms({ m: 2, pubkeys, network }).output!;
  const witness = bitcoin.payments.p2wsh({ redeem: { output: witnessScript }, network });
  const payment = nested ? bitcoin.payments.p2sh({ redeem: witness, network }) : witness;
  return {
    id: `${walletId}-${branch}-${index}`,
    walletId,
    address: payment.address!,
    derivationPath: `${accountPath}/${branch}/${index}`,
    index,
    branch,
    coordinateVersion: 1,
    canonicalPolicyId: policyId,
    canonicalPolicyVersion: 1,
    scriptPubKey: Buffer.from(payment.output!).toString("hex"),
    used: branch === 0,
  };
}

export function multisigBatchFixture(
  walletId: string,
  nested = false,
): BatchBindingFixture {
  const scriptBranch = nested ? 1 : 2;
  const accountPath = `m/48'/1'/0'/${scriptBranch}'`;
  const keys = multisigKeyInfo.slice(0, 2);
  const nodes = keys.map(key => bip32.fromBase58(key.xpub, network));
  const descriptorKey = (keyIndex: number, branch: 0 | 1) =>
    `[${keys[keyIndex].fingerprint}/48'/1'/0'/${scriptBranch}']${keys[keyIndex].xpub}/${branch}/*`;
  const descriptorForBranch = (branch: 0 | 1) => {
    const witness = `wsh(sortedmulti(2,${descriptorKey(0, branch)},${descriptorKey(1, branch)}))`;
    return nested ? `sh(${witness})` : witness;
  };
  const policyId = nested
    ? "multisig-nested-segwit-bip48-1-v1"
    : "multisig-native-segwit-bip48-2-v1";
  const inputAddresses = [0, 1].map(index => multisigAddress(
    walletId, nodes, accountPath, policyId, nested, 0, index,
  ));
  const changeAddress = multisigAddress(
    walletId, nodes, accountPath, policyId, nested, 1, 0,
  );
  const devices = keys.map((key, signerIndex) => ({
    deviceId: `${walletId}-device-${signerIndex}`,
    deviceAccountId: `${walletId}-account-${signerIndex}`,
    signerIndex,
    signerBindingVersion: 1,
    signerFingerprint: key.fingerprint,
    signerXpub: key.xpub,
    signerDerivationPath: accountPath,
    signerPurpose: "multisig",
    signerScriptType: nested ? "nested_segwit" : "native_segwit",
    device: {
      id: `${walletId}-device-${signerIndex}`,
      fingerprint: key.fingerprint,
      xpub: key.xpub,
    },
  }));
  return {
    wallet: {
      id: walletId,
      name: "Bound multisig batch wallet",
      type: "multi_sig",
      scriptType: nested ? "nested_segwit" : "native_segwit",
      network: "testnet",
      descriptor: descriptorForBranch(0),
      changeDescriptor: descriptorForBranch(1),
      canonicalPolicyId: policyId,
      canonicalPolicyVersion: 1,
      fingerprint: keys[0].fingerprint,
      quorum: 2,
      totalSigners: 2,
      devices,
    },
    utxos: [
      utxo(walletId, inputAddresses[0], "cc".repeat(32), 0, 200_000n),
      utxo(walletId, inputAddresses[1], "aa".repeat(32), 0, 100_000n),
    ],
    inputAddresses,
    changeAddress,
  };
}

function addressRowsForQuery(
  query: { where?: { address?: { in?: string[] }; OR?: unknown[]; used?: boolean; branch?: number } },
  fixture: BatchBindingFixture,
) {
  if (query.where?.address?.in) {
    return fixture.inputAddresses.filter(row => query.where?.address?.in?.includes(row.address));
  }
  if (query.where?.OR) {
    return [...fixture.inputAddresses, fixture.changeAddress];
  }
  if (query.where?.used === false || query.where?.branch === 1) {
    return [fixture.changeAddress];
  }
  return [...fixture.inputAddresses, fixture.changeAddress];
}

export function installBatchBindingFixture(fixture: BatchBindingFixture): void {
  mockPrismaClient.wallet.findUnique.mockResolvedValue(fixture.wallet);
  mockPrismaClient.uTXO.findMany.mockResolvedValue(fixture.utxos);
  mockPrismaClient.address.findMany.mockImplementation((query = {}) =>
    Promise.resolve(addressRowsForQuery(query, fixture)),
  );
  mockPrismaClient.address.findFirst.mockImplementation(async (query = {}) =>
    addressRowsForQuery(query, fixture)[0] ?? null,
  );
}
