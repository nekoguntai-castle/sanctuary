// @vitest-environment node

import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import SpeculosTransport from '@ledgerhq/hw-transport-node-speculos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerAdapter } from '../../src/services/hardwareWallet/adapters/ledger';
import {
  expectedLedgerAddress,
  ledgerSignableFixture,
  verifyLedgerFinalizedSignature,
  type LedgerProofScript,
} from './ledgerEmulator/fixtures';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const RUN_PROOF = process.env.LEDGER_EMULATOR_PROOF === '1';
const PURPOSES = [
  { purpose: 44, scriptType: 'legacy' },
  { purpose: 49, scriptType: 'nested_segwit' },
  { purpose: 84, scriptType: 'native_segwit' },
  { purpose: 86, scriptType: 'taproot' },
] as const satisfies ReadonlyArray<{ purpose: number; scriptType: LedgerProofScript }>;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

describe.runIf(RUN_PROOF).sequential('pinned Ledger Speculos conformance', () => {
  let transport: SpeculosTransport;
  let adapter: LedgerAdapter;
  let fingerprint: string;
  const accounts = new Map<string, { xpub: string; account: ReturnType<typeof bip32.fromBase58> }>();
  const family = required('LEDGER_EMULATOR_NETWORK');
  const mainnet = family === 'mainnet';
  const coinType = mainnet ? 0 : 1;
  const appName = mainnet ? 'Bitcoin' : 'Bitcoin Test';
  const networkName = mainnet ? 'mainnet' : 'testnet3';
  const network = mainnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

  beforeAll(async () => {
    expect(required('LEDGER_EMULATOR_APP_VERSION')).toBe('2.4.2');
    expect(required('LEDGER_EMULATOR_SPECULOS_VERSION')).toBe('0.26.9');
    transport = await SpeculosTransport.open({
      host: required('LEDGER_EMULATOR_HOST'),
      apduPort: Number(required('LEDGER_EMULATOR_APDU_PORT')),
    });
    adapter = new LedgerAdapter({
      openTransport: async () => ({
        transport: transport as never,
        device: {
          vendorId: 0x2c97,
          productId: 0x0005,
          serialNumber: `speculos-${family}`,
        } as USBDevice,
      }),
    });
    const connected = await adapter.connect();
    expect(connected).toMatchObject({
      type: 'ledger',
      model: 'Ledger Nano S Plus',
      fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    fingerprint = connected.fingerprint!;
  });

  afterAll(async () => {
    if (adapter) await adapter.disconnect();
  });

  it(`binds every ${appName} BIP44/49/84/86 account 0/7 xpub to one fingerprint`, async () => {
    for (const { purpose } of PURPOSES) {
      for (const accountIndex of [0, 7]) {
        const path = `m/${purpose}'/${coinType}'/${accountIndex}'`;
        const result = await adapter.getXpub(path);
        expect(result).toMatchObject({ path, fingerprint });
        const account = bip32.fromBase58(result.xpub, network);
        accounts.set(path, { xpub: result.xpub, account });
      }
    }
    expect(accounts).toHaveProperty('size', 8);
  });

  it('rejects the opposite coin family before exporting an xpub', async () => {
    const wrongCoin = mainnet ? 1 : 0;
    await expect(adapter.getXpub(`m/84'/${wrongCoin}'/0'`))
      .rejects.toThrow(mainnet ? /Bitcoin Test app is required/ : /Bitcoin app is required/);
  });

  it('device-displays exact receive/change indexes 0 and 19 for every policy/account', async () => {
    for (const { purpose, scriptType } of PURPOSES) {
      for (const accountIndex of [0, 7]) {
        const accountPath = `m/${purpose}'/${coinType}'/${accountIndex}'`;
        const loaded = accounts.get(accountPath)!;
        for (const [branch, index] of [[0, 0], [0, 19], [1, 0], [1, 19]] as const) {
          const expected = expectedLedgerAddress({
            account: loaded.account,
            scriptType,
            branch,
            index,
            network,
          });
          await expect(adapter.verifyAddress(`${accountPath}/${branch}/${index}`, expected))
            .resolves.toBe(true);
        }
      }
    }
  });

  it('signs and independently finalizes every policy at accounts 0 and 7', async () => {
    for (const { purpose, scriptType } of PURPOSES) {
      for (const accountIndex of [0, 7]) {
        const accountPath = `m/${purpose}'/${coinType}'/${accountIndex}'`;
        const loaded = accounts.get(accountPath)!;
        const fixture = ledgerSignableFixture({
          account: loaded.account,
          accountPath,
          accountXpub: loaded.xpub,
          fingerprint,
          scriptType,
          networkName,
          network,
        });
        const response = await adapter.signPSBT(fixture.request);
        expect(response.signatures).toBe(1);
        expect(response.ledgerArtifact).toMatchObject({
          type: 'ledger-signed-psbt',
          sourcePsbt: fixture.request.psbt,
          reconstructedPsbt: response.psbt,
          signatures: [expect.objectContaining({ inputIndex: 0 })],
        });
        const signed = bitcoin.Psbt.fromBase64(response.psbt!, { network });
        const transaction = signed.extractTransaction();
        expect(transaction.outs.map((output) => output.value)).toEqual([50_000n, 49_000n]);
        expect(verifyLedgerFinalizedSignature({
          transaction,
          scriptType,
          inputPubkey: fixture.inputPubkey,
          inputScript: fixture.inputScript,
          inputValue: fixture.inputValue,
        })).toBe(true);
      }
    }
  });
});
