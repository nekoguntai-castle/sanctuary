// @vitest-environment node

import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DerivationNetworkFamily } from '@sanctuary/shared/constants/walletPolicy';
import {
  assertJadeAccountXpubChain,
  masterFingerprintFromRootXpub,
} from '../../src/services/hardwareWallet/adapters/jadeIdentity';
import { JadeProtocolSession, type JadeNetwork } from '../../src/services/hardwareWallet/adapters/jadeProtocol';
import { validateJadeSignedPsbt } from '../../src/services/hardwareWallet/adapters/jadeSignedPsbt';
import { validatePsbtSigningRequest } from '../../src/services/hardwareWallet/psbtAccountBinding';
import {
  JADE_PROOF_POLICIES,
  PUBLIC_TEST_MNEMONIC,
  master,
  pathArray,
  pathString,
  payment,
  signablePsbt,
  signingRequest,
} from './jadeEmulator/fixtures';
import { openJadeTcpTransport, type JadeTcpTransport } from './jadeEmulator/tcpTransport';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const RUN_PROOF = process.env.JADE_EMULATOR_PROOF === '1';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

describe.runIf(RUN_PROOF).sequential('pinned Jade QEMU conformance', () => {
  let transport: JadeTcpTransport;
  let session: JadeProtocolSession;
  const family = RUN_PROOF ? required('JADE_EMULATOR_NETWORK') : 'mainnet';
  const derivationFamily = (family === 'mainnet' ? 'mainnet' : 'testnet') satisfies DerivationNetworkFamily;
  const jadeNetwork = (family === 'mainnet' ? 'mainnet' : 'testnet') satisfies JadeNetwork;
  const network = family === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const coinType = family === 'mainnet' ? 0 : 1;
  const root = master(network);
  let masterFingerprint: string;

  beforeAll(async () => {
    transport = await openJadeTcpTransport(
      required('JADE_EMULATOR_HOST'),
      Number(required('JADE_EMULATOR_SERIAL_PORT')),
    );
    session = new JadeProtocolSession(transport, { rpcTimeoutMs: 30_000, interactiveRpcTimeoutMs: 120_000 });
    const version = await session.rpc('get_version_info');
    expect(version.result).toMatchObject({ JADE_VERSION: required('JADE_EMULATOR_FIRMWARE') });
    await expect(session.rpc('debug_set_mnemonic', {
      mnemonic: PUBLIC_TEST_MNEMONIC,
      passphrase: null,
      temporary_wallet: true,
    })).resolves.toMatchObject({ result: true });
    await session.authenticate(jadeNetwork, async () => {
      throw new Error('An initialized debug wallet must not request a PIN-oracle round trip');
    }, Math.floor(Date.now() / 1000));
    const rootResponse = await session.rpc('get_xpub', { network: jadeNetwork, path: [] });
    masterFingerprint = masterFingerprintFromRootXpub(rootResponse.result, derivationFamily);
    expect(masterFingerprint).toBe(Buffer.from(root.fingerprint).toString('hex'));
  });

  afterAll(async () => {
    if (transport) await transport.invalidate();
  });

  it('exports and production-validates exact BIP44/49/84/86 account identities', async () => {
    for (const { purpose } of JADE_PROOF_POLICIES) {
      for (const account of [0, 7]) {
        const requestedPath = pathArray(purpose, coinType, account);
        const xpubs: unknown[] = [];
        for (let depth = 1; depth <= requestedPath.length; depth++) {
          const response = await session.rpc('get_xpub', {
            network: jadeNetwork,
            path: requestedPath.slice(0, depth),
          });
          xpubs.push(response.result);
        }
        const expected = root.derivePath(pathString(purpose, coinType, account)).neutered().toBase58();
        const validated = assertJadeAccountXpubChain(
          xpubs,
          pathString(purpose, coinType, account),
          derivationFamily,
          masterFingerprint,
        );
        expect(validated).toBe(expected);
        expect(bip32.fromBase58(validated, network).fingerprint).toEqual(
          root.derivePath(pathString(purpose, coinType, account)).fingerprint,
        );
      }
    }
  });

  it('device-displays exact receive and change addresses for every single-signature policy', async () => {
    for (const { purpose, scriptType, variant } of JADE_PROOF_POLICIES) {
      for (const branch of [0, 1]) {
        for (const index of [0, 19]) {
          const path = pathString(purpose, coinType, 0, branch, index);
          const expected = payment(scriptType, root.derivePath(path).publicKey, network).address;
          const response = await session.rpc('get_receive_address', {
            network: jadeNetwork,
            path: pathArray(purpose, coinType, 0, branch, index),
            variant,
          }, true);
          expect(response.result).toBe(expected);
        }
      }
    }
  });

  it('returns a binary signed PSBT accepted by the production request and response validators', async () => {
    for (const { purpose, scriptType, policyId } of JADE_PROOF_POLICIES) {
      for (const account of [0, 7]) {
        const source = signablePsbt({ root, purpose, scriptType, coinType, account, network });
        const signedBytes = await session.signPsbt(jadeNetwork, source.toBuffer());
        const request = signingRequest({
          psbt: source,
          root,
          purpose,
          policyId,
          scriptType,
          coinType,
          account,
          family: derivationFamily,
        });
        const validatedRequest = validatePsbtSigningRequest(request, masterFingerprint);
        const validatedResponse = validateJadeSignedPsbt(validatedRequest, signedBytes);
        expect(validatedResponse.signatures).toBe(1);
        const signed = bitcoin.Psbt.fromBase64(validatedResponse.psbt, { network });
        expect(signed.data.globalMap.unsignedTx.toBuffer()).toEqual(source.data.globalMap.unsignedTx.toBuffer());
        signed.finalizeAllInputs();
        expect(signed.extractTransaction().outs.map(output => output.value)).toEqual([50_000n, 49_000n]);
      }
    }
  });
});
