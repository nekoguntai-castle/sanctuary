/**
 * Ledger PSBT signing helper coverage tests
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockDefaultWalletPolicy, mockPsbtFromBase64 } = vi.hoisted(() => {
  const mockPsbtFromBase64 = vi.fn();

  const MockDefaultWalletPolicy = vi.fn(function MockDefaultWalletPolicy(
    this: any,
    template: string,
    keyInfo: string,
  ) {
    this.template = template;
    this.keyInfo = keyInfo;
  });

  return {
    MockDefaultWalletPolicy,
    mockPsbtFromBase64,
  };
});

vi.mock("@ledgerhq/ledger-bitcoin", () => ({
  DefaultWalletPolicy: MockDefaultWalletPolicy,
}));

vi.mock("bitcoinjs-lib", () => ({
  Psbt: {
    fromBase64: (...args: unknown[]) => mockPsbtFromBase64(...args),
  },
}));

vi.mock("../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { signPsbt } from "../../src/services/hardwareWallet/adapters/ledger/signPsbt";

function makeLedgerPsbt(path = "m/84'/0'/0'/0/0") {
  return {
    data: {
      inputs: [
        {
          bip32Derivation: [
            {
              path,
              masterFingerprint: Buffer.from("01020304", "hex"),
              pubkey: Buffer.from(`02${"11".repeat(32)}`, "hex"),
            },
          ],
        },
      ],
    },
    toBase64: vi.fn(() => "updated-psbt"),
    updateInput: vi.fn(),
    finalizeAllInputs: vi.fn(),
  };
}

function makeAppClient(
  options: {
    fingerprint?: string;
    xpub?: string;
    signatures?: Array<
      [
        number,
        {
          pubkey: Buffer;
          signature: Buffer;
        },
      ]
    >;
  } = {},
) {
  const {
    fingerprint = "aabbccdd",
    xpub = "xpub-mock",
    signatures = [],
  } = options;

  return {
    getMasterFingerprint: vi.fn().mockResolvedValue(fingerprint),
    getExtendedPubkey: vi.fn().mockResolvedValue(xpub),
    signPsbt: vi.fn().mockResolvedValue(signatures),
  };
}

describe("Ledger signPsbt helper", () => {
  beforeEach(() => {
    mockPsbtFromBase64.mockReset();
    MockDefaultWalletPolicy.mockClear();
  });

  it("signs and finalizes a PSBT using mocked Ledger responses", async () => {
    const appClient = makeAppClient({
      xpub: "xpub-abc",
      signatures: [
        [
          0,
          {
            pubkey: Buffer.from(`02${"11".repeat(32)}`, "hex"),
            signature: Buffer.from("3044", "hex"),
          },
        ],
      ],
    });
    const mockPsbt = makeLedgerPsbt();
    mockPsbtFromBase64.mockReturnValue(mockPsbt);

    const result = await signPsbt(appClient as any, {
      psbt: "base64-psbt",
      inputPaths: ["m/84'/0'/0'/0/0"],
    });

    expect(MockDefaultWalletPolicy).toHaveBeenCalledTimes(1);
    expect(MockDefaultWalletPolicy).toHaveBeenCalledWith(
      "wpkh(@0/**)",
      "[aabbccdd/84'/0'/0']xpub-abc",
    );
    expect(appClient.signPsbt.mock.calls[0][1]).toMatchObject({
      template: "wpkh(@0/**)",
      keyInfo: "[aabbccdd/84'/0'/0']xpub-abc",
    });
    expect(appClient.signPsbt).toHaveBeenCalledWith(
      "updated-psbt",
      expect.any(Object),
      null,
    );
    expect(mockPsbt.updateInput).toHaveBeenCalledTimes(1);
    expect(mockPsbt.finalizeAllInputs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      psbt: "updated-psbt",
      signatures: 1,
    });
  });

  it("maps descriptor templates for explicit and inferred script types", async () => {
    const appClient = makeAppClient({ xpub: "xpub-template" });
    const cases: Array<{
      accountPath: string;
      scriptType?: string;
      expected: string;
    }> = [
      {
        accountPath: "m/49'/0'/0'",
        scriptType: "p2sh-p2wpkh",
        expected: "sh(wpkh(@0/**))",
      },
      {
        accountPath: "m/44'/0'/0'",
        scriptType: "p2pkh",
        expected: "pkh(@0/**)",
      },
      { accountPath: "m/86'/0'/0'", scriptType: "p2tr", expected: "tr(@0/**)" },
      {
        accountPath: "m/84'/0'/0'",
        scriptType: "unknown",
        expected: "wpkh(@0/**)",
      },
      { accountPath: "m/49'/0'/0'", expected: "sh(wpkh(@0/**))" },
      { accountPath: "m/44'/0'/0'", expected: "pkh(@0/**)" },
      { accountPath: "m/86'/0'/0'", expected: "tr(@0/**)" },
      { accountPath: "m/0/0/0", expected: "wpkh(@0/**)" },
    ];

    for (const [idx, item] of cases.entries()) {
      const psbt = makeLedgerPsbt(`${item.accountPath}/0/0`);
      mockPsbtFromBase64.mockReturnValueOnce(psbt).mockReturnValueOnce(psbt);
      await signPsbt(appClient as any, {
        psbt: `psbt-${idx}`,
        accountPath: item.accountPath,
        scriptType: item.scriptType as any,
        inputPaths: [],
      });
      expect(MockDefaultWalletPolicy).toHaveBeenLastCalledWith(
        item.expected,
        expect.any(String),
      );
    }
  });

  it("uses inputPaths/default account fallbacks and reports missing bip32Derivation", async () => {
    const appClient = makeAppClient({ xpub: "xpub-fallback" });
    const missingBip32Psbt = {
      data: { inputs: [{}] },
      toBase64: vi.fn(() => "psbt-input-path"),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64
      .mockReturnValueOnce(missingBip32Psbt)
      .mockReturnValueOnce(missingBip32Psbt);

    await expect(
      signPsbt(appClient as any, {
        psbt: "missing-bip32",
        inputPaths: ["m/44'"],
      }),
    ).rejects.toThrow("PSBT is missing bip32Derivation");
    expect(appClient.getExtendedPubkey).toHaveBeenCalledWith("m/44'");

    const defaultAccountPsbt = {
      data: { inputs: [] },
      toBase64: vi.fn(() => "psbt-default"),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64
      .mockReturnValueOnce(defaultAccountPsbt)
      .mockReturnValueOnce(defaultAccountPsbt);
    const result = await signPsbt(appClient as any, {
      psbt: "default-account",
      inputPaths: [],
    });

    expect(appClient.getExtendedPubkey).toHaveBeenLastCalledWith("m/84'/0'/0'");
    expect(result).toEqual({ psbt: "psbt-default", signatures: 0 });
  });

  it("covers missing PSBT, empty input path, and fingerprint updates", async () => {
    const appClient = makeAppClient({ xpub: "xpub-branches" });
    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error("invalid psbt");
    });

    await expect(
      signPsbt(appClient as any, { inputPaths: [] } as any),
    ).rejects.toThrow("invalid psbt");

    const emptyPathPsbt = {
      data: {
        inputs: [
          {
            bip32Derivation: [
              {
                path: "",
                masterFingerprint: Buffer.from("aabbccdd", "hex"),
                pubkey: Buffer.from(`02${"11".repeat(32)}`, "hex"),
              },
            ],
          },
        ],
      },
      toBase64: vi.fn(() => "psbt-empty-path"),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64
      .mockReturnValueOnce(emptyPathPsbt)
      .mockReturnValueOnce(emptyPathPsbt);
    await signPsbt(appClient as any, {
      psbt: "empty-path",
      inputPaths: ["m/84'/0'/0'/0/9"],
    });
    expect(appClient.getExtendedPubkey).toHaveBeenCalledWith("m/84'/0'/0'");

    const mismatchPsbt = {
      data: {
        inputs: [
          {
            bip32Derivation: [
              {
                path: "m/84'/0'/0'/0/0",
                masterFingerprint: Buffer.from("01020304", "hex"),
                pubkey: Buffer.from(`02${"22".repeat(32)}`, "hex"),
              },
            ],
          },
        ],
      },
      toBase64: vi.fn(() => "psbt-mismatch"),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64
      .mockReturnValueOnce(mismatchPsbt)
      .mockReturnValueOnce(mismatchPsbt);
    await signPsbt(appClient as any, {
      psbt: "mismatch",
      inputPaths: ["m/84'/0'/0'/0/0"],
    });
    expect(
      mismatchPsbt.data.inputs[0].bip32Derivation[0].masterFingerprint.toString(
        "hex",
      ),
    ).toBe("aabbccdd");
  });
});
