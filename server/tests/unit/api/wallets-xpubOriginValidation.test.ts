import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../src/services/bitcoin/bip32';
import { errorHandler } from '../../../src/errors/errorHandler';
import xpubValidationRouter from '../../../src/api/wallets/xpubValidation';

const ACCOUNT_ZERO_XPUB = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';

function mainnetXpub(path: Array<{ index: number; hardened: boolean }>): string {
  let node = bip32.fromSeed(Buffer.alloc(32, 42), bitcoin.networks.bitcoin);
  for (const component of path) {
    node = component.hardened
      ? node.deriveHardened(component.index)
      : node.derive(component.index);
  }
  return node.neutered().toBase58();
}

describe('validate-xpub canonical origin binding', () => {
  const app = express();

  beforeAll(() => {
    app.use(express.json());
    app.use('/api/v1/wallets', xpubValidationRouter);
    app.use(errorHandler);
  });

  async function validate(xpub: string, accountPath = "84'/0'/0'") {
    return request(app).post('/api/v1/wallets/validate-xpub').send({
      xpub,
      scriptType: 'native_segwit',
      network: 'mainnet',
      fingerprint: 'aabbccdd',
      accountPath,
    });
  }

  it('accepts an account xpub whose serialized depth and hardened child match the origin', async () => {
    const response = await validate(ACCOUNT_ZERO_XPUB);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ valid: true, accountPath: "84'/0'/0'" });
  });

  it('rejects an account-zero xpub declared as account seven', async () => {
    const response = await validate(ACCOUNT_ZERO_XPUB, "84'/0'/7'");
    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('descriptor');
  });

  it('rejects an xpub whose serialized depth is above the declared account level', async () => {
    const depthTwo = mainnetXpub([
      { index: 84, hardened: true },
      { index: 0, hardened: true },
    ]);
    const response = await validate(depthTwo);
    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('descriptor');
  });

  it('rejects an unhardened final child mislabeled as a hardened account', async () => {
    const unhardenedAccount = mainnetXpub([
      { index: 84, hardened: true },
      { index: 0, hardened: true },
      { index: 0, hardened: false },
    ]);
    const response = await validate(unhardenedAccount);
    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('descriptor');
  });
});
