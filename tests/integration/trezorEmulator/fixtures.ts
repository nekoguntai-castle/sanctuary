import { BIP32Factory, type BIP32Interface } from "bip32";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import type {
  PsbtSigningContext,
  PsbtSignerOrigin,
} from "@sanctuary/shared/schemas/psbtSigningContext";
import type { PSBTSignRequest } from "../../../src/services/hardwareWallet/types";
import { bytesSha256 } from "./proofReplay";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const TESTNET = bitcoin.networks.testnet;
const TEST_AMOUNT = 100_000n;
const OTHER_SEED = Uint8Array.from(Buffer.from("22".repeat(32), "hex"));

interface ProofSigner {
  accountPath: string;
  accountXpub: string;
  masterFingerprint: string;
}

export interface SignableFixture {
  psbt: bitcoin.Psbt;
  previous: bitcoin.Transaction;
  request: PSBTSignRequest;
  inputPath: string;
  changePath: string;
  inputAddress: string;
}

export interface MultisigFixture extends SignableFixture {
  xpubs: Record<string, string>;
}

function signerOrigin(
  masterFingerprint: Uint8Array,
  path: string,
  pubkey: Uint8Array,
): PsbtSignerOrigin {
  return {
    masterFingerprint: Buffer.from(masterFingerprint).toString("hex"),
    path,
    pubkey: Buffer.from(pubkey).toString("hex"),
  };
}

function signingContext(args: {
  psbt: bitcoin.Psbt;
  previous: bitcoin.Transaction;
  walletType: "single_sig" | "multi_sig";
  scriptType: "native_segwit" | "nested_segwit" | "taproot";
  policyId: string;
  signers: ProofSigner[];
  inputPath: string;
  inputOrigins: PsbtSignerOrigin[];
  changePath: string;
  changeOrigins: PsbtSignerOrigin[];
}): PsbtSigningContext {
  const inputOutput = args.previous.outs[0];
  const changeOutput = args.psbt.txOutputs[1];
  return {
    version: 1,
    walletId: "trezor-emulator-proof",
    network: "testnet3",
    walletType: args.walletType,
    scriptType: args.scriptType,
    canonicalPolicyId: args.policyId,
    canonicalPolicyVersion: 1,
    descriptorDigest: "11".repeat(32),
    unsignedTransactionDigest: bytesSha256(
      args.psbt.data.globalMap.unsignedTx.toBuffer(),
    ),
    signers: args.signers.map((signer, signerIndex) => ({
      signerIndex,
      deviceId: `trezor-emulator-${signer.masterFingerprint}`,
      deviceAccountId: `trezor-emulator-account-${signerIndex}`,
      ...signer,
    })),
    inputs: [
      {
        inputIndex: 0,
        txid: args.previous.getId(),
        vout: 0,
        amountSats: inputOutput.value.toString(),
        scriptPubKey: Buffer.from(inputOutput.script).toString("hex"),
        addressPath: args.inputPath,
        signerOrigins: args.inputOrigins,
      },
    ],
    changeOutputs: [
      {
        outputIndex: 1,
        amountSats: changeOutput.value.toString(),
        scriptPubKey: Buffer.from(changeOutput.script).toString("hex"),
        addressPath: args.changePath,
        signerOrigins: args.changeOrigins,
      },
    ],
  };
}

function previousTransaction(script: Uint8Array): bitcoin.Transaction {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(
    Buffer.alloc(32),
    0xffffffff,
    0xffffffff,
    Buffer.from([0]),
  );
  transaction.addOutput(script, TEST_AMOUNT);
  return transaction;
}

function requirePayment<T extends { output?: Uint8Array; address?: string }>(
  payment: T,
  label: string,
): T & {
  output: Uint8Array;
  address: string;
} {
  if (!payment.output || !payment.address)
    throw new Error(`Unable to derive ${label}`);
  return payment as T & { output: Uint8Array; address: string };
}

export function addressForAccount(
  account: BIP32Interface,
  branch: number,
  index: number,
  nested = false,
): string {
  const witness = bitcoin.payments.p2wpkh({
    pubkey: Uint8Array.from(account.derive(branch).derive(index).publicKey),
    network: TESTNET,
  });
  const payment = nested
    ? bitcoin.payments.p2sh({ redeem: witness, network: TESTNET })
    : witness;
  return requirePayment(payment, "emulator proof address").address;
}

export function singleSigFixture(args: {
  account: BIP32Interface;
  accountXpub: string;
  fingerprint: Uint8Array;
  recipient: string;
  nested: boolean;
}): SignableFixture {
  const { account, accountXpub, fingerprint, recipient, nested } = args;
  const purpose = nested ? 49 : 84;
  const accountPath = `m/${purpose}'/1'/0'`;
  const inputPath = `${accountPath}/0/0`;
  const changePath = `${accountPath}/1/0`;
  const child = account.derive(0).derive(0);
  const changeChild = account.derive(1).derive(0);
  const witness = requirePayment(
    bitcoin.payments.p2wpkh({
      pubkey: Uint8Array.from(child.publicKey),
      network: TESTNET,
    }),
    "single-signature witness address",
  );
  const changeWitness = requirePayment(
    bitcoin.payments.p2wpkh({
      pubkey: Uint8Array.from(changeChild.publicKey),
      network: TESTNET,
    }),
    "single-signature change witness address",
  );
  const payment = nested
    ? requirePayment(
        bitcoin.payments.p2sh({ redeem: witness, network: TESTNET }),
        "nested single-signature address",
      )
    : witness;
  const changePayment = nested
    ? requirePayment(
        bitcoin.payments.p2sh({ redeem: changeWitness, network: TESTNET }),
        "nested change address",
      )
    : changeWitness;
  const previous = previousTransaction(payment.output);
  const psbt = new bitcoin.Psbt({ network: TESTNET });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    nonWitnessUtxo: Uint8Array.from(previous.toBuffer()),
    witnessUtxo: { script: payment.output, value: TEST_AMOUNT },
    ...(nested ? { redeemScript: witness.output } : {}),
    bip32Derivation: [
      {
        masterFingerprint: Uint8Array.from(fingerprint),
        path: inputPath,
        pubkey: Uint8Array.from(child.publicKey),
      },
    ],
  });
  psbt.addOutput({ address: recipient, value: 50_000n });
  psbt.addOutput({
    script: changePayment.output,
    value: 49_000n,
    ...(nested ? { redeemScript: changeWitness.output } : {}),
    bip32Derivation: [
      {
        masterFingerprint: Uint8Array.from(fingerprint),
        path: changePath,
        pubkey: Uint8Array.from(changeChild.publicKey),
      },
    ],
  });
  const request: PSBTSignRequest = {
    walletId: "trezor-emulator-proof",
    psbt: psbt.toBase64(),
    signingContext: signingContext({
      psbt,
      previous,
      walletType: "single_sig",
      scriptType: nested ? "nested_segwit" : "native_segwit",
      policyId: nested
        ? "single-sig-nested-segwit-bip49-v1"
        : "single-sig-native-segwit-bip84-v1",
      signers: [
        {
          masterFingerprint: Buffer.from(fingerprint).toString("hex"),
          accountPath,
          accountXpub,
        },
      ],
      inputPath,
      inputOrigins: [signerOrigin(fingerprint, inputPath, child.publicKey)],
      changePath,
      changeOrigins: [
        signerOrigin(fingerprint, changePath, changeChild.publicKey),
      ],
    }),
  };
  return {
    psbt,
    previous,
    request,
    inputPath,
    changePath,
    inputAddress: payment.address,
  };
}

export function taprootFixture(args: {
  account: BIP32Interface;
  accountXpub: string;
  fingerprint: Uint8Array;
  recipient: string;
}): SignableFixture {
  const { account, accountXpub, fingerprint, recipient } = args;
  const accountPath = "m/86'/1'/0'";
  const inputPath = `${accountPath}/0/0`;
  const changePath = `${accountPath}/1/0`;
  const child = account.derive(0).derive(0);
  const changeChild = account.derive(1).derive(0);
  const internalPubkey = Uint8Array.from(child.publicKey.slice(1, 33));
  const changeInternalPubkey = Uint8Array.from(
    changeChild.publicKey.slice(1, 33),
  );
  const payment = requirePayment(
    bitcoin.payments.p2tr({ internalPubkey, network: TESTNET }),
    "Taproot address",
  );
  const changePayment = requirePayment(
    bitcoin.payments.p2tr({
      internalPubkey: changeInternalPubkey,
      network: TESTNET,
    }),
    "Taproot change address",
  );
  const previous = previousTransaction(payment.output);
  const psbt = new bitcoin.Psbt({ network: TESTNET });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    nonWitnessUtxo: Uint8Array.from(previous.toBuffer()),
    witnessUtxo: { script: payment.output, value: TEST_AMOUNT },
    tapInternalKey: internalPubkey,
    tapBip32Derivation: [
      {
        masterFingerprint: Uint8Array.from(fingerprint),
        path: inputPath,
        pubkey: internalPubkey,
        leafHashes: [],
      },
    ],
  });
  psbt.addOutput({ address: recipient, value: 50_000n });
  psbt.addOutput({
    script: changePayment.output,
    value: 49_000n,
    tapInternalKey: changeInternalPubkey,
    tapBip32Derivation: [
      {
        masterFingerprint: Uint8Array.from(fingerprint),
        path: changePath,
        pubkey: changeInternalPubkey,
        leafHashes: [],
      },
    ],
  });
  const request: PSBTSignRequest = {
    walletId: "trezor-emulator-proof",
    psbt: psbt.toBase64(),
    signingContext: signingContext({
      psbt,
      previous,
      walletType: "single_sig",
      scriptType: "taproot",
      policyId: "single-sig-taproot-bip86-v1",
      signers: [
        {
          masterFingerprint: Buffer.from(fingerprint).toString("hex"),
          accountPath,
          accountXpub,
        },
      ],
      inputPath,
      inputOrigins: [signerOrigin(fingerprint, inputPath, internalPubkey)],
      changePath,
      changeOrigins: [
        signerOrigin(fingerprint, changePath, changeInternalPubkey),
      ],
    }),
  };
  return {
    psbt,
    previous,
    request,
    inputPath,
    changePath,
    inputAddress: payment.address,
  };
}

export function multisigFixture(args: {
  deviceAccount: BIP32Interface;
  fingerprint: Uint8Array;
  recipient: string;
  nested: boolean;
  preSignOther?: boolean;
}): MultisigFixture {
  const {
    deviceAccount,
    fingerprint,
    recipient,
    nested,
    preSignOther = true,
  } = args;
  const branchPurpose = nested ? 1 : 2;
  const accountPath = `m/48'/1'/0'/${branchPurpose}'`;
  const otherRoot = bip32.fromSeed(OTHER_SEED, TESTNET);
  const otherAccount = otherRoot.derivePath(accountPath);
  const otherFingerprint = Uint8Array.from(otherRoot.fingerprint);
  const originsFor = (branch: number) =>
    [
      {
        fingerprint,
        account: deviceAccount,
        child: deviceAccount.derive(branch).derive(0),
        path: `${accountPath}/${branch}/0`,
      },
      {
        fingerprint: otherFingerprint,
        account: otherAccount,
        child: otherAccount.derive(branch).derive(0),
        path: `${accountPath}/${branch}/0`,
      },
    ].sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.child.publicKey),
        Buffer.from(right.child.publicKey),
      ),
    );
  const origins = originsFor(0);
  const changeOrigins = originsFor(1);
  const multisigPayment = (items: typeof origins) => {
    const witnessScript = bitcoin.payments.p2ms({
      m: 2,
      pubkeys: items.map((item) => Uint8Array.from(item.child.publicKey)),
      network: TESTNET,
    }).output!;
    const witness = requirePayment(
      bitcoin.payments.p2wsh({
        redeem: { output: witnessScript },
        network: TESTNET,
      }),
      "multisig witness address",
    );
    const payment = nested
      ? requirePayment(
          bitcoin.payments.p2sh({ redeem: witness, network: TESTNET }),
          "nested multisig address",
        )
      : witness;
    return { witnessScript, witness, payment };
  };
  const inputPayment = multisigPayment(origins);
  const changePayment = multisigPayment(changeOrigins);
  const previous = previousTransaction(inputPayment.payment.output);
  const psbt = new bitcoin.Psbt({ network: TESTNET });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    nonWitnessUtxo: Uint8Array.from(previous.toBuffer()),
    witnessUtxo: { script: inputPayment.payment.output, value: TEST_AMOUNT },
    witnessScript: inputPayment.witnessScript,
    ...(nested ? { redeemScript: inputPayment.witness.output } : {}),
    bip32Derivation: origins.map((origin) => ({
      masterFingerprint: Uint8Array.from(origin.fingerprint),
      path: origin.path,
      pubkey: Uint8Array.from(origin.child.publicKey),
    })),
  });
  psbt.addOutput({ address: recipient, value: 50_000n });
  psbt.addOutput({
    script: changePayment.payment.output,
    value: 49_000n,
    witnessScript: changePayment.witnessScript,
    ...(nested ? { redeemScript: changePayment.witness.output } : {}),
    bip32Derivation: changeOrigins.map((origin) => ({
      masterFingerprint: Uint8Array.from(origin.fingerprint),
      path: origin.path,
      pubkey: Uint8Array.from(origin.child.publicKey),
    })),
  });
  const otherInput = origins.find((origin) =>
    Buffer.from(origin.fingerprint).equals(Buffer.from(otherFingerprint)),
  );
  if (!otherInput) throw new Error("Missing emulator multisig cosigner");
  if (preSignOther) psbt.signInput(0, otherInput.child);
  const xpubs = Object.fromEntries(
    origins.map((origin) => [
      Buffer.from(origin.fingerprint).toString("hex"),
      origin.account.neutered().toBase58(),
    ]),
  );
  const inputPath = `${accountPath}/0/0`;
  const changePath = `${accountPath}/1/0`;
  const request: PSBTSignRequest = {
    walletId: "trezor-emulator-proof",
    psbt: psbt.toBase64(),
    multisigXpubs: xpubs,
    signingContext: signingContext({
      psbt,
      previous,
      walletType: "multi_sig",
      scriptType: nested ? "nested_segwit" : "native_segwit",
      policyId: nested
        ? "multisig-nested-segwit-bip48-1-v1"
        : "multisig-native-segwit-bip48-2-v1",
      signers: origins.map((origin) => ({
        masterFingerprint: Buffer.from(origin.fingerprint).toString("hex"),
        accountPath,
        accountXpub: origin.account.neutered().toBase58(),
      })),
      inputPath,
      inputOrigins: origins.map((origin) =>
        signerOrigin(origin.fingerprint, origin.path, origin.child.publicKey),
      ),
      changePath,
      changeOrigins: changeOrigins.map((origin) =>
        signerOrigin(origin.fingerprint, origin.path, origin.child.publicKey),
      ),
    }),
  };
  return {
    psbt,
    previous,
    request,
    inputPath,
    changePath,
    inputAddress: inputPayment.payment.address,
    xpubs,
  };
}
