import { describe, expect, it } from 'vitest';

import { SigningIntentSnapshotSchema } from '../../../../../src/services/bitcoin/signingIntent/schema';

/**
 * Direct boundary tests for the signing intent snapshot schema.
 *
 * The schema is a module-level constant, so the mutation gate runs every test
 * that loads it against each mutant. Before this file, no test fed it a value
 * just outside a pattern or a bound, and 13 mutants (dropped anchors, a dropped
 * `min(1)`, a blanked enum member) survived about 1,660 tests each.
 */

const TXID = 'a'.repeat(64);

const input = (overrides: Record<string, unknown> = {}, prevout: Record<string, unknown> = {}) => ({
  txid: TXID,
  vout: 0,
  sequence: 0xfffffffd,
  prevout: { amountSats: '1000', scriptPubKeyHex: '0014ab', role: 'wallet', ...prevout },
  ...overrides,
});

const output = (overrides: Record<string, unknown> = {}) => ({
  amountSats: '900',
  scriptPubKeyHex: '0014cd',
  ...overrides,
});

const snapshot = (transaction: Record<string, unknown> = {}) => ({
  version: 1,
  walletId: 'wallet-1',
  network: 'mainnet',
  transaction: {
    version: 2,
    locktime: 0,
    inputs: [input()],
    outputs: [output()],
    ...transaction,
  },
});

const accepts = (value: unknown): boolean => SigningIntentSnapshotSchema.safeParse(value).success;

describe('signing intent snapshot schema boundaries', () => {
  it('accepts the baseline snapshot every case below varies', () => {
    expect(accepts(snapshot())).toBe(true);
  });

  it.each(['0', '1', '2100000000000000'])('accepts the amount %s', (amountSats) => {
    expect(accepts(snapshot({ outputs: [output({ amountSats })] }))).toBe(true);
    expect(accepts(snapshot({ inputs: [input({}, { amountSats })] }))).toBe(true);
  });

  it.each(['', '01', 'x1', '1x', '-1', '1.5', ' 1', '1\n2'])('rejects the amount %j', (amountSats) => {
    expect(accepts(snapshot({ outputs: [output({ amountSats })] }))).toBe(false);
    expect(accepts(snapshot({ inputs: [input({}, { amountSats })] }))).toBe(false);
  });

  it.each(['', '00', '0014ab'])('accepts the script %j', (scriptPubKeyHex) => {
    expect(accepts(snapshot({ outputs: [output({ scriptPubKeyHex })] }))).toBe(true);
    expect(accepts(snapshot({ inputs: [input({}, { scriptPubKeyHex })] }))).toBe(true);
  });

  it.each(['a', 'abc', 'zz', 'zz00', '00zz', '00AB', '0x00'])('rejects the script %j', (scriptPubKeyHex) => {
    expect(accepts(snapshot({ outputs: [output({ scriptPubKeyHex })] }))).toBe(false);
    expect(accepts(snapshot({ inputs: [input({}, { scriptPubKeyHex })] }))).toBe(false);
  });

  it.each([
    ['a leading extra character', `x${TXID}`],
    ['a trailing extra character', `${TXID}x`],
    ['65 hex characters', `${TXID}a`],
    ['63 hex characters', TXID.slice(1)],
    ['upper-case hex', TXID.toUpperCase()],
  ])('rejects a txid with %s', (_reason, txid) => {
    expect(accepts(snapshot({ inputs: [input({ txid })] }))).toBe(false);
    expect(accepts(snapshot({ replacementTxid: txid }))).toBe(false);
  });

  it('accepts a well-formed replacement txid', () => {
    expect(accepts(snapshot({ replacementTxid: 'b'.repeat(64) }))).toBe(true);
  });

  it.each([0, 1, 0xffffffff])('accepts the output index %d', (vout) => {
    expect(accepts(snapshot({ inputs: [input({ vout })] }))).toBe(true);
  });

  it.each([-1, 0x100000000, 0.5])('rejects the output index %d', (vout) => {
    expect(accepts(snapshot({ inputs: [input({ vout })] }))).toBe(false);
  });

  it.each(['wallet', 'payjoin_peer'])('accepts the prevout role %s', (role) => {
    expect(accepts(snapshot({ inputs: [input({}, { role })] }))).toBe(true);
  });

  it.each(['', 'peer', 'Wallet'])('rejects the prevout role %j', (role) => {
    expect(accepts(snapshot({ inputs: [input({}, { role })] }))).toBe(false);
  });

  it('requires at least one input and one output, and accepts several', () => {
    expect(accepts(snapshot({ inputs: [] }))).toBe(false);
    expect(accepts(snapshot({ outputs: [] }))).toBe(false);
    expect(accepts(snapshot({
      inputs: [input(), input({ vout: 1 })],
      outputs: [output(), output({ amountSats: '50' })],
    }))).toBe(true);
  });
});
