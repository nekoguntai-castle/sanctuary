import { expect, it, vi } from 'vitest';
import type * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import {
  getTransactionFieldPatch,
  mockGetNodeClient,
  mockRecalculateWalletBalances,
} from './confirmationsTestHarness';
import {
  OP_RETURN_SCRIPT,
  buildTransaction,
  nodeDetails,
  serveNodeTransactions,
  walletOutput,
} from './confirmationsNodeFixtures';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

const A1 = walletOutput(11);
const A2 = walletOutput(12);
const RECIPIENT = walletOutput(2);
const SENDER = walletOutput(7);
const ATTACKER = walletOutput(9);

type RowType = 'sent' | 'received' | 'consolidation';

function row(id: string, tx: bitcoin.Transaction, type: RowType, overrides: Record<string, unknown> = {}) {
  return {
    id,
    txid: tx.getId(),
    type,
    amount: type === 'received' ? BigInt(50_000) : type === 'sent' ? BigInt(-99_000) : BigInt(0),
    fee: null,
    blockHeight: 999,
    blockTime: new Date('2024-01-01T00:00:00.000Z'),
    confirmations: 1,
    addressId: null,
    counterpartyAddress: null,
    ...overrides,
  };
}

/** A parent paying `valueSats` (and optional extra outputs) to `script`; `seed` keeps parents distinct. */
function parent(seed: number, valueSats: bigint, script: Uint8Array = A1.script, extra: bigint[] = []) {
  return buildTransaction({
    inputs: [{ txid: seed.toString(16).padStart(2, '0').repeat(32), vout: 0 }],
    outputs: [valueSats, ...extra].map(value => ({ script, valueSats: value })),
  });
}

/** Spends `prev:vout` and pays 90_000 to the recipient plus 9_000 change (99_000 total). */
function sentSpending(prev: bitcoin.Transaction, vout = 0, recipient: Uint8Array = RECIPIENT.script) {
  return buildTransaction({
    inputs: [{ txid: prev.getId(), vout }],
    outputs: [{ script: recipient, valueSats: BigInt(90_000) }, { script: A1.script, valueSats: BigInt(9_000) }],
  });
}

function consolidationSpending(prev: bitcoin.Transaction) {
  return buildTransaction({
    inputs: [{ txid: prev.getId(), vout: 0 }],
    outputs: [{ script: A1.script, valueSats: BigInt(99_000) }],
  });
}

function receivedSpending(prev: bitcoin.Transaction, payTo: Uint8Array = A1.script) {
  return buildTransaction({
    inputs: [{ txid: prev.getId(), vout: 0 }],
    outputs: [{ script: payTo, valueSats: BigInt(50_000) }],
  });
}

async function populateWith(rows: unknown[], served: Array<[string, unknown]>) {
  mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
  mockGetNodeClient.mockResolvedValue({
    getAddressHistory: vi.fn(async () => []),
    getTransaction: serveNodeTransactions(served),
  });
  mockPrismaClient.transaction.findMany.mockResolvedValue(rows);
  mockPrismaClient.address.findMany.mockResolvedValue([
    { id: 'addr-1', address: A1.address },
    { id: 'addr-2', address: A2.address },
  ]);
  return populateMissingTransactionFields('wallet-1');
}

function withVout0(details: ReturnType<typeof nodeDetails>, patch: Record<string, unknown>) {
  const [first, ...rest] = details.vout;
  return { ...details, vout: [{ ...first, ...patch }, ...rest] };
}

function withVout0Address(details: ReturnType<typeof nodeDetails>, address: string) {
  return withVout0(details, { scriptPubKey: { ...details.vout[0].scriptPubKey, address, addresses: [address] } });
}

export function registerPopulateMissingTransactionFieldsAuthenticationContracts() {
  it('does not compute a sent fee from a parent whose bytes hash to a different txid', async () => {
    const p = parent(1, BigInt(100_000));
    const forged = parent(1, BigInt(150_000));
    const s = sentSpending(p);
    await populateWith([row('s', s, 'sent', { counterpartyAddress: 'set' })], [
      [s.getId(), nodeDetails(s)],
      [p.getId(), nodeDetails(forged)],
    ]);
    expect(getTransactionFieldPatch('s')?.data.fee).toBeUndefined();
  });

  it('does not forge a consolidation fee, amount or balance recalculation from a substituted parent', async () => {
    const p = parent(1, BigInt(100_000));
    const forged = parent(1, BigInt(150_000));
    const c = consolidationSpending(p);
    await populateWith([row('c', c, 'consolidation')], [
      [c.getId(), nodeDetails(c)],
      [p.getId(), nodeDetails(forged)],
    ]);
    expect(getTransactionFieldPatch('c')).toBeUndefined();
    expect(mockRecalculateWalletBalances).not.toHaveBeenCalled();
  });

  it('does not take a sent counterparty from a substituted current transaction', async () => {
    const p = parent(1, BigInt(100_000));
    const s = sentSpending(p);
    const forged = sentSpending(p, 0, ATTACKER.script);
    await populateWith([row('s', s, 'sent', { fee: BigInt(1_000) })], [
      [s.getId(), nodeDetails(forged)],
      [p.getId(), nodeDetails(p)],
    ]);
    expect(getTransactionFieldPatch('s')?.data.counterpartyAddress).toBeUndefined();
  });

  it('does not take a received counterparty from a substituted parent', async () => {
    const p2 = parent(2, BigInt(60_000), SENDER.script);
    const forged = parent(2, BigInt(60_000), ATTACKER.script);
    const r = receivedSpending(p2);
    await populateWith([row('r', r, 'received')], [
      [r.getId(), nodeDetails(r)],
      [p2.getId(), nodeDetails(forged)],
    ]);
    expect(getTransactionFieldPatch('r')?.data.counterpartyAddress).toBeUndefined();
  });

  it('does not take a received addressId from a substituted current transaction', async () => {
    const p = parent(2, BigInt(60_000), SENDER.script);
    const r = receivedSpending(p, A1.script);
    const forged = receivedSpending(p, A2.script);
    await populateWith([row('r', r, 'received', { counterpartyAddress: 'set' })], [
      [r.getId(), nodeDetails(forged)],
      [p.getId(), nodeDetails(p)],
    ]);
    expect(getTransactionFieldPatch('r')?.data.addressId).toBeUndefined();
  });

  it('ignores a verbose fee and computes the fee from the authenticated parent', async () => {
    const p = parent(1, BigInt(100_000));
    const s3 = sentSpending(p);
    await populateWith([row('s3', s3, 'sent', { counterpartyAddress: 'set' })], [
      [s3.getId(), { ...nodeDetails(s3), fee: 0.5 }],
      [p.getId(), nodeDetails(p)],
    ]);
    expect(getTransactionFieldPatch('s3')?.data.fee).toBe(BigInt(1_000));
  });

  it('ignores a verbose input prevout address for the received counterparty', async () => {
    const p = parent(2, BigInt(60_000), SENDER.script);
    const r3 = receivedSpending(p);
    const details = nodeDetails(r3);
    const vin = [{ ...details.vin[0], prevout: { scriptPubKey: { address: ATTACKER.address } } }];
    await populateWith([row('r3', r3, 'received', { addressId: 'addr-1' })], [
      [r3.getId(), { ...details, vin }],
      [p.getId(), nodeDetails(p)],
    ]);
    expect(getTransactionFieldPatch('r3')?.data.counterpartyAddress).toBe(SENDER.address);
  });

  it('ignores a verbose input prevout naming a wallet address for the sent addressId', async () => {
    const p = parent(1, BigInt(100_000));
    const s4 = sentSpending(p);
    const details = nodeDetails(s4);
    const vin = [{ ...details.vin[0], prevout: { scriptPubKey: { address: A1.address } } }];
    await populateWith([row('s4', s4, 'sent', { fee: BigInt(1_000), counterpartyAddress: 'set' })], [
      [s4.getId(), { ...details, vin }],
      [p.getId(), nodeDetails(p)],
    ]);
    expect(getTransactionFieldPatch('s4')?.data.addressId).toBeUndefined();
  });

  it('ignores a client vout that differs from the authenticated bytes', async () => {
    const p = parent(1, BigInt(100_000));
    const s5 = sentSpending(p);
    const attackerVout = nodeDetails(sentSpending(p, 0, ATTACKER.script)).vout;
    await populateWith([row('s5', s5, 'sent', { fee: BigInt(1_000) })], [
      [s5.getId(), { ...nodeDetails(s5), vout: attackerVout }],
      [p.getId(), nodeDetails(p)],
    ]);
    expect(getTransactionFieldPatch('s5')?.data.counterpartyAddress).toBe(RECIPIENT.address);
  });

  it('ignores a client address on an output whose script has no address', async () => {
    const p = parent(1, BigInt(100_000));
    const s6 = sentSpending(p, 0, OP_RETURN_SCRIPT);
    await populateWith([row('s6', s6, 'sent', { fee: BigInt(1_000) })], [
      [s6.getId(), withVout0Address(nodeDetails(s6), ATTACKER.address)],
      [p.getId(), nodeDetails(p)],
    ]);
    expect(getTransactionFieldPatch('s6')?.data.counterpartyAddress).toBeUndefined();
  });

  it('ignores a client vin naming a genuine larger parent', async () => {
    const p = parent(1, BigInt(100_000));
    const pl = parent(3, BigInt(150_000));
    const s7 = sentSpending(p);
    await populateWith([row('s7', s7, 'sent', { counterpartyAddress: 'set' })], [
      [s7.getId(), { ...nodeDetails(s7), vin: [{ txid: pl.getId(), vout: 0 }] }],
      [p.getId(), nodeDetails(p)],
      [pl.getId(), nodeDetails(pl)],
    ]);
    expect(getTransactionFieldPatch('s7')?.data.fee).toBe(BigInt(1_000));
  });

  it('ignores a client value on an authenticated parent output', async () => {
    const p = parent(1, BigInt(100_000));
    const s8 = sentSpending(p);
    await populateWith([row('s8', s8, 'sent', { counterpartyAddress: 'set' })], [
      [s8.getId(), nodeDetails(s8)],
      [p.getId(), withVout0(nodeDetails(p), { value: 0.0015 })],
    ]);
    expect(getTransactionFieldPatch('s8')?.data.fee).toBe(BigInt(1_000));
  });

  it('ignores a client address on an authenticated parent output', async () => {
    const p = parent(4, BigInt(60_000), walletOutput(1).script);
    const r4 = receivedSpending(p);
    await populateWith([row('r4', r4, 'received', { addressId: 'addr-1' })], [
      [r4.getId(), nodeDetails(r4)],
      [p.getId(), withVout0Address(nodeDetails(p), ATTACKER.address)],
    ]);
    expect(getTransactionFieldPatch('r4')?.data.counterpartyAddress).toBe(walletOutput(1).address);
  });

  it('ignores a client vin index pointing at a larger output of the same parent', async () => {
    const p = parent(1, BigInt(100_000), A1.script, [BigInt(150_000)]);
    const s9 = sentSpending(p);
    await populateWith([row('s9', s9, 'sent', { counterpartyAddress: 'set' })], [
      [s9.getId(), { ...nodeDetails(s9), vin: [{ txid: p.getId(), vout: 1 }] }],
      [p.getId(), nodeDetails(p)],
    ]);
    expect(getTransactionFieldPatch('s9')?.data.fee).toBe(BigInt(1_000));
  });

  it('populates the same fields from an honest server', async () => {
    const p = parent(1, BigInt(100_000));
    const pc = parent(5, BigInt(100_000));
    const pr = parent(2, BigInt(60_000), SENDER.script);
    const s = sentSpending(p);
    const c = consolidationSpending(pc);
    const r = receivedSpending(pr);
    await populateWith([row('s', s, 'sent'), row('c', c, 'consolidation'), row('r', r, 'received')], [
      ...[s, c, r, p, pc, pr].map((tx): [string, unknown] => [tx.getId(), nodeDetails(tx)]),
    ]);
    expect(getTransactionFieldPatch('s')?.data).toEqual({
      fee: BigInt(1_000),
      counterpartyAddress: RECIPIENT.address,
    });
    expect(getTransactionFieldPatch('c')?.data).toEqual({ fee: BigInt(1_000), amount: BigInt(-1_000) });
    expect(getTransactionFieldPatch('r')?.data).toEqual({
      counterpartyAddress: SENDER.address,
      addressId: 'addr-1',
    });
    expect(mockRecalculateWalletBalances).toHaveBeenCalledWith('wallet-1', undefined, expect.any(Function));
  });
}
