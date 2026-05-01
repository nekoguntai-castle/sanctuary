import * as bitcoin from "bitcoinjs-lib";
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
          multisigKeys: testMultisigKeys,
          multisigQuorum: 2,
          multisigScriptType: "wsh-sortedmulti",
        },
        networkObj: network,
      }),
    ).toThrow("failed to build witnessScript");
  });

  it("logs skipped BIP32 metadata when optional multisig key list is empty on single-sig signing info", () => {
    const psbt = new bitcoin.Psbt({ network });

    const inputPaths = addInputsWithBip32(psbt, [baseUtxo], {
      sequence: 0xfffffffd,
      isLegacy: false,
      rawTxCache: new Map(),
      addressPathMap: new Map(),
      signingInfo: {
        isMultisig: false,
        multisigKeys: [],
      },
      networkObj: network,
    });

    expect(inputPaths).toEqual([""]);
    expect(psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    expect(mockBuildMultisigBip32Derivations).not.toHaveBeenCalled();
  });
});
