import * as bitcoin from "bitcoinjs-lib";
import bip32 from "../../../../src/services/bitcoin/bip32";
import { addInputsWithBip32 } from "../../../../src/services/bitcoin/transactions/psbtInputConstruction";
import { testMultisigKeys } from "./psbtBuilderTestFixtures";

const { mockBuildMultisigBip32Derivations, mockBuildMultisigWitnessScript } = vi.hoisted(() => ({
  mockBuildMultisigBip32Derivations: vi.fn(),
  mockBuildMultisigWitnessScript: vi.fn(),
}));

vi.mock("../../../../src/services/bitcoin/psbtBuilder", () => ({
  buildMultisigBip32Derivations: mockBuildMultisigBip32Derivations,
  buildMultisigWitnessScript: mockBuildMultisigWitnessScript,
}));

const network = bitcoin.networks.testnet;
const validPubkeys = [
  "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
  "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
];
const inputScriptPubKey = Buffer.from(
  bitcoin.payments.p2wpkh({
    hash: Buffer.alloc(20, 2),
    network,
  }).output!,
).toString("hex");

const baseUtxo = {
  txid: "11".repeat(32),
  vout: 0,
  amount: 50_000,
  address: "tb1qinputaddress",
  scriptPubKey: inputScriptPubKey,
};

describe("PSBT input construction branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildMultisigBip32Derivations.mockReturnValue(
      testMultisigKeys.map((key, index) => ({
        masterFingerprint: Buffer.from(key.fingerprint, "hex"),
        path: `m/48'/1'/0'/2'/0/${index}`,
        pubkey: Buffer.from(validPubkeys[index], "hex"),
      })),
    );
    mockBuildMultisigWitnessScript.mockReturnValue(Buffer.from([0x51, 0xae]));
  });

  it("throws when multisig witness script construction fails after derivation metadata succeeds", () => {
    const psbt = new bitcoin.Psbt({ network });
    mockBuildMultisigWitnessScript.mockReturnValue(undefined);

    expect(() =>
      addInputsWithBip32(psbt, [baseUtxo], {
        sequence: 0xfffffffd,
        isLegacy: false,
        rawTxCache: new Map(),
        addressPathMap: new Map([[baseUtxo.address, "m/48'/1'/0'/2'/0/0"]]),
        signingInfo: {
          isMultisig: true,
          scriptType: "native_segwit",
          multisigKeys: testMultisigKeys,
          multisigQuorum: 2,
          multisigScriptType: "wsh-sortedmulti",
        },
        networkObj: network,
      }),
    ).toThrow("failed to build witnessScript");
  });

  it("rejects incomplete multisig BIP32 metadata before adding scripts", () => {
    const psbt = new bitcoin.Psbt({ network });
    mockBuildMultisigBip32Derivations.mockReturnValueOnce([]);

    expect(() =>
      addInputsWithBip32(psbt, [baseUtxo], {
        sequence: 0xfffffffd,
        isLegacy: false,
        rawTxCache: new Map(),
        addressPathMap: new Map([[baseUtxo.address, "m/48'/1'/0'/2'/0/0"]]),
        signingInfo: {
          isMultisig: true,
          scriptType: "native_segwit",
          multisigKeys: testMultisigKeys,
          multisigQuorum: 2,
          multisigScriptType: "wsh-sortedmulti",
        },
        networkObj: network,
      }),
    ).toThrow("failed to build complete BIP32 derivation metadata");
    expect(mockBuildMultisigWitnessScript).not.toHaveBeenCalled();
  });

  it.each(["m/84'/1'/0'/0/5", "m/84h/1h/0h/0/5"])(
    "derives exact single-sig metadata from account node for %s",
    derivationPath => {
      const psbt = new bitcoin.Psbt({ network });
      const accountNode = bip32.fromSeed(Buffer.alloc(32, 7), network)
        .deriveHardened(84).deriveHardened(1).deriveHardened(0).neutered();

      expect(addInputsWithBip32(psbt, [baseUtxo], {
        sequence: 0xfffffffd,
        isLegacy: false,
        rawTxCache: new Map(),
        addressPathMap: new Map([[baseUtxo.address, derivationPath]]),
        signingInfo: {
          isMultisig: false,
          scriptType: "native_segwit",
          masterFingerprint: Buffer.from("aabbccdd", "hex"),
        },
        accountNode,
        networkObj: network,
      })).toEqual([derivationPath]);
      expect(psbt.data.inputs[0].bip32Derivation).toEqual([{
        masterFingerprint: Buffer.from("aabbccdd", "hex"),
        path: "m/84'/1'/0'/0/5",
        pubkey: accountNode.derive(0).derive(5).publicKey,
      }]);
    },
  );

  it.each(["m/86'/1'/0'/0/5", "m/86h/1h/0h/0/5"])(
    "adds exact BIP371 key-path metadata for single-sig Taproot input %s",
    derivationPath => {
      const psbt = new bitcoin.Psbt({ network });
      const accountNode = bip32.fromSeed(Buffer.alloc(32, 9), network)
        .deriveHardened(86).deriveHardened(1).deriveHardened(0).neutered();
      const childPubkey = Buffer.from(accountNode.derive(0).derive(5).publicKey);
      const internalPubkey = childPubkey.subarray(1, 33);

      expect(addInputsWithBip32(psbt, [baseUtxo], {
        sequence: 0xfffffffd,
        isLegacy: false,
        rawTxCache: new Map(),
        addressPathMap: new Map([[baseUtxo.address, derivationPath]]),
        signingInfo: {
          isMultisig: false,
          scriptType: "taproot",
          masterFingerprint: Buffer.from("aabbccdd", "hex"),
        },
        accountNode,
        networkObj: network,
      })).toEqual([derivationPath]);

      expect(psbt.data.inputs[0].tapInternalKey).toEqual(internalPubkey);
      expect(psbt.data.inputs[0].tapBip32Derivation).toEqual([{
        masterFingerprint: Buffer.from("aabbccdd", "hex"),
        path: "m/86'/1'/0'/0/5",
        pubkey: internalPubkey,
        leafHashes: [],
      }]);
      expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    },
  );

  it("rejects single-sig inputs when BIP32 derivation metadata is unavailable", () => {
    const psbt = new bitcoin.Psbt({ network });

    expect(() =>
      addInputsWithBip32(psbt, [baseUtxo], {
        sequence: 0xfffffffd,
        isLegacy: false,
        rawTxCache: new Map(),
        addressPathMap: new Map(),
        signingInfo: {
          isMultisig: false,
          scriptType: "native_segwit",
          multisigKeys: [],
        },
        networkObj: network,
      }),
    ).toThrow("Cannot create PSBT: missing BIP32 derivation metadata for input 0");

    expect(mockBuildMultisigBip32Derivations).not.toHaveBeenCalled();
  });
});
