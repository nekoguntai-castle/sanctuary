// @vitest-environment node

import { mkdir, writeFile } from "node:fs/promises";
import { BIP32Factory, type BIP32Interface } from "bip32";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import TrezorConnect from "@trezor/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TrezorAdapter } from "../../src/services/hardwareWallet/adapters/trezor/trezorAdapter";
import {
  buildTrezorInputs,
  buildTrezorOutputs,
} from "../../src/services/hardwareWallet/adapters/trezor/signPsbtPayloads";
import {
  assertSessionIdentity,
  connectDevice,
  requireResolvedSession,
} from "../../src/services/hardwareWallet/adapters/trezor/sessionIdentity";
import type { PSBTSignResponse } from "../../src/services/hardwareWallet/types";
import type { TrezorConnection } from "../../src/services/hardwareWallet/adapters/trezor/types";
import {
  EXPECTED_TREZOR_EMULATOR_PROOF,
  TREZOR_EMULATOR_PROOF_CONTRACT,
} from "../fixtures/trezorEmulatorProof";
import {
  closeBridgeProxy,
  confirmOnEmulator,
  controllerCommand,
  requiredEnvironment,
  startLocalBridgeProxy,
} from "./trezorEmulator/controller";
import {
  addressForAccount,
  multisigFixture,
  singleSigFixture,
  taprootFixture,
  type MultisigFixture,
  type SignableFixture,
} from "./trezorEmulator/fixtures";
import {
  assertReturnedMultisigPsbt,
  proofArtifact,
  replayFirstSignerArtifactIndependently,
  replayArtifactIndependently,
  type ProofArtifact,
} from "./trezorEmulator/proofReplay";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const RUN_PROOF = process.env.TREZOR_EMULATOR_PROOF === "1";
const TESTNET = bitcoin.networks.testnet;
type Session = ReturnType<typeof requireResolvedSession>;
type AddressMultisig = NonNullable<
  ReturnType<typeof buildTrezorInputs>[number]["multisig"]
>;

interface ConnectIdentity {
  path?: unknown;
  state?: unknown;
  instance?: unknown;
}

interface ConnectResult<T> {
  success: boolean;
  payload: T & { error?: string };
  device?: ConnectIdentity;
}

interface EmulatorAccounts {
  bip49: BIP32Interface;
  bip84Account0: BIP32Interface;
  bip84Account1: BIP32Interface;
  bip86: BIP32Interface;
  bip48Nested: BIP32Interface;
  bip48Native: BIP32Interface;
  xpubs: {
    bip49: string;
    bip84Account0: string;
    bip84Account1: string;
    bip86: string;
    bip48Nested: string;
    bip48Native: string;
  };
}

interface ProofState {
  fingerprint: string;
  vectors: Record<string, string>;
  artifacts: Record<string, ProofArtifact>;
}

let bridgeProxy: Awaited<ReturnType<typeof startLocalBridgeProxy>> = null;
let session: Session | null = null;
let fingerprint: Buffer | null = null;
let adapter: TrezorAdapter | null = null;
let accounts: EmulatorAccounts | null = null;
let connectInitialized = false;
const originalWindow = globalThis.window;
const proofState: ProofState = { fingerprint: "", vectors: {}, artifacts: {} };

function requireRuntime() {
  if (!adapter || !session || !fingerprint || !accounts) {
    throw new Error("Trezor emulator proof setup is incomplete");
  }
  return { adapter, session, fingerprint, accounts };
}

function successPayload<T>(result: ConnectResult<T>, operation: string): T {
  const runtime = requireRuntime();
  if (!result.success)
    throw new Error(
      `${operation} failed: ${result.payload.error ?? "unknown error"}`,
    );
  if (!result.device) throw new Error(`${operation} omitted device identity`);
  assertSessionIdentity(result.device, runtime.session);
  return result.payload;
}

async function writeEvidence(name: string, value: unknown): Promise<void> {
  const evidenceDir = requiredEnvironment("TREZOR_EMULATOR_EVIDENCE_DIR");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    `${evidenceDir}/${name}.json`,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function getAddress(args: {
  path: string;
  scriptType: "SPENDWITNESS" | "SPENDP2SHWITNESS" | "SPENDTAPROOT";
  display: boolean;
  idBase: number;
  multisig?: AddressMultisig;
}): Promise<string> {
  const runtime = requireRuntime();
  const operation = TrezorConnect.getAddress({
    path: args.path,
    coin: "Testnet",
    scriptType: args.scriptType,
    showOnTrezor: args.display,
    multisig: args.multisig,
    device: connectDevice(runtime.session),
  }) as Promise<ConnectResult<{ address: string }>>;
  const result = args.display
    ? await confirmOnEmulator(operation, args.idBase)
    : await operation;
  return successPayload(result, `getAddress ${args.path}`).address;
}

function artifactFromResponse(response: PSBTSignResponse): ProofArtifact {
  expect(response.trezorArtifact).toBeDefined();
  const native = response.trezorArtifact!;
  return proofArtifact(
    native.sourcePsbt,
    native.connectSignatures,
    native.serializedTx,
  );
}

async function signAndReplay(args: {
  name: string;
  fixture: SignableFixture;
  scriptType: "SPENDWITNESS" | "SPENDP2SHWITNESS" | "SPENDTAPROOT";
  expectedChangeScriptType:
    "PAYTOWITNESS" | "PAYTOP2SHWITNESS" | "PAYTOTAPROOT";
  expectedChangePath: number[];
  taproot: boolean;
  idBase: number;
  multisig: boolean;
  firstMultisigSigner?: boolean;
}): Promise<void> {
  const runtime = requireRuntime();
  const inputs = buildTrezorInputs(
    args.fixture.psbt,
    args.fixture.request,
    args.scriptType,
    runtime.fingerprint,
    runtime.fingerprint.toString("hex"),
  );
  const outputs = buildTrezorOutputs(
    args.fixture.psbt,
    args.fixture.request,
    args.scriptType,
    true,
    runtime.fingerprint,
    runtime.fingerprint.toString("hex"),
  );
  expect(inputs[0].script_type).toBe(args.scriptType);
  expect(outputs[1]).toMatchObject({
    address_n: args.expectedChangePath,
    script_type: args.expectedChangeScriptType,
  });
  if (args.multisig) {
    expect(inputs[0].multisig).toMatchObject({
      m: 2,
      pubkeys_order: "LEXICOGRAPHIC",
    });
    expect(inputs[0].multisig.signatures.filter(Boolean)).toHaveLength(
      args.firstMultisigSigner ? 0 : 1,
    );
    expect(outputs[1].multisig).toMatchObject({
      m: 2,
      pubkeys_order: "LEXICOGRAPHIC",
    });
  }
  const response = await confirmOnEmulator(
    runtime.adapter.signPSBT(args.fixture.request),
    args.idBase,
  );
  if (args.multisig) expect(response.rawTx).toBeUndefined();
  else expect(response.rawTx).toEqual(expect.any(String));
  const artifact = artifactFromResponse(response);
  const independentlySigned = args.firstMultisigSigner
    ? replayFirstSignerArtifactIndependently(artifact, runtime.fingerprint)
    : replayArtifactIndependently(artifact, runtime.fingerprint, args.taproot);
  if (args.multisig) {
    assertReturnedMultisigPsbt(
      response.psbt,
      args.fixture.psbt,
      independentlySigned,
      runtime.fingerprint,
    );
    if (args.firstMultisigSigner) {
      expect(response.signatures).toBe(args.fixture.psbt.inputCount);
      expect(() => independentlySigned.clone().finalizeAllInputs()).toThrow();
    }
  }
  proofState.artifacts[args.name] = artifact;
  await writeEvidence(`signing-${args.name}`, {
    artifact,
    returnedPsbt: response.psbt ?? null,
  });
}

async function establishSession(): Promise<void> {
  if (!adapter) throw new Error("Trezor adapter was not initialized");
  const device = await adapter.connect();
  expect(device.model).toBe("Trezor Model T");
  expect(device.firmwareVersion).toBe(TREZOR_EMULATOR_PROOF_CONTRACT.firmware);
  expect(device.transportVersion).toBe(TREZOR_EMULATOR_PROOF_CONTRACT.connect);
  expect(device.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  const connection = (adapter as unknown as { connection: TrezorConnection })
    .connection;
  if (!connection.session || !device.fingerprint) {
    throw new Error(
      "Production Trezor adapter omitted its authenticated session",
    );
  }
  session = connection.session;
  fingerprint = Buffer.from(device.fingerprint, "hex");
  proofState.fingerprint = device.fingerprint;
}

async function loadAccounts(): Promise<EmulatorAccounts> {
  if (!adapter) throw new Error("Trezor adapter was not initialized");
  // Trezor Connect intentionally permits only one active device call.
  const bip49 = await adapter.getXpub("m/49'/1'/0'");
  const bip84Account0 = await adapter.getXpub("m/84'/1'/0'");
  const bip84Account1 = await adapter.getXpub("m/84'/1'/1'");
  const bip86 = await adapter.getXpub("m/86'/1'/0'");
  const bip48Nested = await adapter.getXpub("m/48'/1'/0'/1'");
  const bip48Native = await adapter.getXpub("m/48'/1'/0'/2'");
  return {
    bip49: bip32.fromBase58(bip49.xpub, TESTNET),
    bip84Account0: bip32.fromBase58(bip84Account0.xpub, TESTNET),
    bip84Account1: bip32.fromBase58(bip84Account1.xpub, TESTNET),
    bip86: bip32.fromBase58(bip86.xpub, TESTNET),
    bip48Nested: bip32.fromBase58(bip48Nested.xpub, TESTNET),
    bip48Native: bip32.fromBase58(bip48Native.xpub, TESTNET),
    xpubs: {
      bip49: bip49.xpub,
      bip84Account0: bip84Account0.xpub,
      bip84Account1: bip84Account1.xpub,
      bip86: bip86.xpub,
      bip48Nested: bip48Nested.xpub,
      bip48Native: bip48Native.xpub,
    },
  };
}

describe
  .runIf(RUN_PROOF)
  .sequential("pinned Trezor User Env conformance", () => {
    beforeAll(async () => {
      expect(requiredEnvironment("TREZOR_EMULATOR_IMAGE")).toBe(
        TREZOR_EMULATOR_PROOF_CONTRACT.image,
      );
      expect(requiredEnvironment("TREZOR_EMULATOR_MODEL")).toBe(
        TREZOR_EMULATOR_PROOF_CONTRACT.model,
      );
      expect(requiredEnvironment("TREZOR_EMULATOR_FIRMWARE")).toBe(
        TREZOR_EMULATOR_PROOF_CONTRACT.firmware,
      );
      expect(requiredEnvironment("TREZOR_EMULATOR_BRIDGE_VERSION")).toBe(
        TREZOR_EMULATOR_PROOF_CONTRACT.bridge,
      );
      expect(requiredEnvironment("TREZOR_EMULATOR_CONNECT_VERSION")).toBe(
        TREZOR_EMULATOR_PROOF_CONTRACT.connect,
      );
      bridgeProxy = await startLocalBridgeProxy();
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          isSecureContext: true,
          location: { origin: "https://sanctuary.local" },
        },
      });
      adapter = new TrezorAdapter({
        manifest: {
          email: "ci@sanctuary.local",
          appUrl: "https://sanctuary.local",
          appName: "Sanctuary Trezor Proof",
        },
        transports: ["BridgeTransport"],
        pendingTransportEvent: false,
        debug: false,
      });
      connectInitialized = true;
      await establishSession();
      accounts = await loadAccounts();
    }, 60_000);

    afterAll(async () => {
      try {
        if (adapter) await adapter.disconnect().catch(() => undefined);
        if (connectInitialized) TrezorConnect.dispose();
      } finally {
        await closeBridgeProxy(bridgeProxy).catch(() => undefined);
        if (originalWindow === undefined)
          Reflect.deleteProperty(globalThis, "window");
        else
          Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: originalWindow,
          });
      }
    });

    it("derives the exact BIP49, BIP84, BIP86, and BIP48 account vectors", async () => {
      const runtime = requireRuntime();
      proofState.vectors = {
        bip49Account0Xpub: runtime.accounts.xpubs.bip49,
        bip84Account0Xpub: runtime.accounts.xpubs.bip84Account0,
        bip84Account1Xpub: runtime.accounts.xpubs.bip84Account1,
        bip86Account0Xpub: runtime.accounts.xpubs.bip86,
        bip48NestedAccount0Xpub: runtime.accounts.xpubs.bip48Nested,
        bip48NativeAccount0Xpub: runtime.accounts.xpubs.bip48Native,
      };
      expect({
        fingerprint: proofState.fingerprint,
        ...proofState.vectors,
      }).toEqual({
        fingerprint: EXPECTED_TREZOR_EMULATOR_PROOF.fingerprint,
        bip49Account0Xpub: EXPECTED_TREZOR_EMULATOR_PROOF.bip49Account0Xpub,
        bip84Account0Xpub: EXPECTED_TREZOR_EMULATOR_PROOF.bip84Account0Xpub,
        bip84Account1Xpub: EXPECTED_TREZOR_EMULATOR_PROOF.bip84Account1Xpub,
        bip86Account0Xpub: EXPECTED_TREZOR_EMULATOR_PROOF.bip86Account0Xpub,
        bip48NestedAccount0Xpub:
          EXPECTED_TREZOR_EMULATOR_PROOF.bip48NestedAccount0Xpub,
        bip48NativeAccount0Xpub:
          EXPECTED_TREZOR_EMULATOR_PROOF.bip48NativeAccount0Xpub,
      });
      await writeEvidence("derivation-vectors", {
        fingerprint: proofState.fingerprint,
        ...proofState.vectors,
      });
    });

    it("displays exact BIP49, BIP84, and BIP86 single-signature addresses", async () => {
      const runtime = requireRuntime();
      const bip49Receive0 = addressForAccount(
        runtime.accounts.bip49,
        0,
        0,
        true,
      );
      const bip84Receive0 = addressForAccount(
        runtime.accounts.bip84Account0,
        0,
        0,
      );
      const bip84Change0 = addressForAccount(
        runtime.accounts.bip84Account0,
        1,
        0,
      );
      const bip84Receive19 = addressForAccount(
        runtime.accounts.bip84Account0,
        0,
        19,
      );
      const bip84Account1Receive0 = addressForAccount(
        runtime.accounts.bip84Account1,
        0,
        0,
      );
      const taprootFixture0 = taprootFixture({
        account: runtime.accounts.bip86,
        accountXpub: runtime.accounts.xpubs.bip86,
        fingerprint: runtime.fingerprint,
        recipient: bip84Receive0,
      });
      expect(
        await confirmOnEmulator(
          runtime.adapter.verifyAddress("m/84'/1'/0'/0/0", bip84Receive0),
          1_000,
        ),
      ).toBe(true);
      expect(
        await confirmOnEmulator(
          runtime.adapter.verifyAddress("m/84'/1'/0'/1/0", bip84Change0),
          1_020,
        ),
      ).toBe(true);
      expect(
        await getAddress({
          path: "m/49'/1'/0'/0/0",
          scriptType: "SPENDP2SHWITNESS",
          display: true,
          idBase: 1_040,
        }),
      ).toBe(bip49Receive0);
      expect(
        await getAddress({
          path: "m/84'/1'/0'/0/19",
          scriptType: "SPENDWITNESS",
          display: false,
          idBase: 1_060,
        }),
      ).toBe(bip84Receive19);
      expect(
        await getAddress({
          path: "m/84'/1'/1'/0/0",
          scriptType: "SPENDWITNESS",
          display: false,
          idBase: 1_080,
        }),
      ).toBe(bip84Account1Receive0);
      expect(
        await confirmOnEmulator(
          runtime.adapter.verifyAddress(
            "m/86'/1'/0'/0/0",
            taprootFixture0.inputAddress,
          ),
          1_100,
        ),
      ).toBe(true);
      Object.assign(proofState.vectors, {
        bip49Receive0,
        bip84Receive0,
        bip84Change0,
        bip84Receive19,
        bip84Account1Receive0,
        bip86Receive0: taprootFixture0.inputAddress,
      });
      await writeEvidence("display-single-signature", proofState.vectors);
    }, 90_000);

    it("displays the exact BIP48 /1 nested multisig address", async () => {
      const runtime = requireRuntime();
      await controllerCommand({
        type: "emulator-allow-unsafe-paths",
        id: 1_200,
      });
      const fixture = multisigFixture({
        deviceAccount: runtime.accounts.bip48Nested,
        fingerprint: runtime.fingerprint,
        recipient: proofState.vectors.bip84Receive0,
        nested: true,
      });
      const input = buildTrezorInputs(
        fixture.psbt,
        fixture.request,
        "SPENDP2SHWITNESS",
        runtime.fingerprint,
        runtime.fingerprint.toString("hex"),
      )[0];
      expect(
        await getAddress({
          path: fixture.inputPath,
          scriptType: "SPENDP2SHWITNESS",
          display: true,
          idBase: 1_220,
          multisig: input.multisig,
        }),
      ).toBe(fixture.inputAddress);
      proofState.vectors.bip48NestedReceive0 = fixture.inputAddress;
      await writeEvidence("display-bip48-nested-multisig", {
        address: fixture.inputAddress,
      });
    }, 60_000);

    it("signs and independently replays BIP84 native SegWit", async () => {
      const runtime = requireRuntime();
      await signAndReplay({
        name: "bip84-native-single",
        fixture: singleSigFixture({
          account: runtime.accounts.bip84Account0,
          accountXpub: runtime.accounts.xpubs.bip84Account0,
          fingerprint: runtime.fingerprint,
          recipient: proofState.vectors.bip84Receive19,
          nested: false,
        }),
        scriptType: "SPENDWITNESS",
        expectedChangeScriptType: "PAYTOWITNESS",
        expectedChangePath: [0x80000054, 0x80000001, 0x80000000, 1, 0],
        taproot: false,
        idBase: 1_300,
        multisig: false,
      });
    }, 60_000);

    it("signs and independently replays BIP49 nested SegWit", async () => {
      const runtime = requireRuntime();
      await signAndReplay({
        name: "bip49-nested-single",
        fixture: singleSigFixture({
          account: runtime.accounts.bip49,
          accountXpub: runtime.accounts.xpubs.bip49,
          fingerprint: runtime.fingerprint,
          recipient: proofState.vectors.bip84Receive0,
          nested: true,
        }),
        scriptType: "SPENDP2SHWITNESS",
        expectedChangeScriptType: "PAYTOP2SHWITNESS",
        expectedChangePath: [0x80000031, 0x80000001, 0x80000000, 1, 0],
        taproot: false,
        idBase: 1_400,
        multisig: false,
      });
    }, 60_000);

    it("signs and independently replays BIP86 Taproot", async () => {
      const runtime = requireRuntime();
      await signAndReplay({
        name: "bip86-taproot-single",
        fixture: taprootFixture({
          account: runtime.accounts.bip86,
          accountXpub: runtime.accounts.xpubs.bip86,
          fingerprint: runtime.fingerprint,
          recipient: proofState.vectors.bip84Receive0,
        }),
        scriptType: "SPENDTAPROOT",
        expectedChangeScriptType: "PAYTOTAPROOT",
        expectedChangePath: [0x80000056, 0x80000001, 0x80000000, 1, 0],
        taproot: true,
        idBase: 1_500,
        multisig: false,
      });
    }, 60_000);

    it.each([
      [
        "bip48-native-multisig",
        false,
        "SPENDWITNESS",
        "PAYTOWITNESS",
        2,
        1_600,
      ],
      [
        "bip48-nested-multisig",
        true,
        "SPENDP2SHWITNESS",
        "PAYTOP2SHWITNESS",
        1,
        1_700,
      ],
    ] as const)(
      "signs, preserves, and independently replays %s",
      async (name, nested, scriptType, outputScriptType, purpose, idBase) => {
        const runtime = requireRuntime();
        await controllerCommand({
          type: "emulator-allow-unsafe-paths",
          id: idBase - 1,
        });
        const account = nested
          ? runtime.accounts.bip48Nested
          : runtime.accounts.bip48Native;
        const fixture: MultisigFixture = multisigFixture({
          deviceAccount: account,
          fingerprint: runtime.fingerprint,
          recipient: proofState.vectors.bip84Receive0,
          nested,
        });
        await signAndReplay({
          name,
          fixture,
          scriptType,
          expectedChangeScriptType: outputScriptType,
          expectedChangePath: [
            0x80000030,
            0x80000001,
            0x80000000,
            0x80000000 + purpose,
            1,
            0,
          ],
          taproot: false,
          idBase,
          multisig: true,
        });
      },
      90_000,
    );

    it.each([
      [
        "bip48-native-first-signer",
        false,
        "SPENDWITNESS",
        "PAYTOWITNESS",
        2,
        1_800,
      ],
      [
        "bip48-nested-first-signer",
        true,
        "SPENDP2SHWITNESS",
        "PAYTOP2SHWITNESS",
        1,
        1_900,
      ],
    ] as const)(
      "persists the first Trezor signature without falsely finalizing %s",
      async (name, nested, scriptType, outputScriptType, purpose, idBase) => {
        const runtime = requireRuntime();
        await controllerCommand({
          type: "emulator-allow-unsafe-paths",
          id: idBase - 1,
        });
        const account = nested
          ? runtime.accounts.bip48Nested
          : runtime.accounts.bip48Native;
        const fixture: MultisigFixture = multisigFixture({
          deviceAccount: account,
          fingerprint: runtime.fingerprint,
          recipient: proofState.vectors.bip84Receive0,
          nested,
          preSignOther: false,
        });
        expect(fixture.psbt.data.inputs[0].partialSig ?? []).toHaveLength(0);
        await signAndReplay({
          name,
          fixture,
          scriptType,
          expectedChangeScriptType: outputScriptType,
          expectedChangePath: [
            0x80000030,
            0x80000001,
            0x80000000,
            0x80000000 + purpose,
            1,
            0,
          ],
          taproot: false,
          idBase,
          multisig: true,
          firstMultisigSigner: true,
        });
      },
      90_000,
    );

    it("matches immutable evidence and writes a granular proof index", async () => {
      expect({
        fingerprint: proofState.fingerprint,
        ...proofState.vectors,
      }).toEqual(EXPECTED_TREZOR_EMULATOR_PROOF);
      expect(Object.keys(proofState.artifacts).sort()).toEqual([
        "bip48-native-first-signer",
        "bip48-native-multisig",
        "bip48-nested-first-signer",
        "bip48-nested-multisig",
        "bip49-nested-single",
        "bip84-native-single",
        "bip86-taproot-single",
      ]);
      await writeEvidence("proof", {
        contract: TREZOR_EMULATOR_PROOF_CONTRACT,
        proof: proofState,
      });
    });
  });
