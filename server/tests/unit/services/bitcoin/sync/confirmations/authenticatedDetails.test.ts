import { describe, expect, it } from 'vitest';

import { authenticatedPopulationDetails } from '../../../../../../src/services/bitcoin/sync/confirmations/authenticatedDetails';
import { RawTransactionEvidenceError } from '../../../../../../src/services/bitcoin/rawTransactionEvidence';
import {
  COINBASE_SCRIPT_SIG_HEX,
  buildTransaction,
  nodeDetails,
  walletOutput,
} from './confirmationsNodeFixtures';

const PARENT_TXID = '11'.repeat(32);
const OTHER_PARENT_TXID = '22'.repeat(32);
const RECIPIENT = walletOutput(2);
const ATTACKER = walletOutput(9);
const OP_RETURN_HEX = '6a026869';

function reasonOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof RawTransactionEvidenceError) return error.reason;
    throw error;
  }
  return undefined;
}

function spendWithOpReturn() {
  return buildTransaction({
    inputs: [{ txid: PARENT_TXID, vout: 0 }],
    outputs: [
      { script: Uint8Array.from(Buffer.from(OP_RETURN_HEX, 'hex')), valueSats: BigInt(0) },
      { script: RECIPIENT.script, valueSats: BigInt(90_000) },
    ],
  });
}

describe('authenticatedPopulationDetails', () => {
  it('projects a coinbase input with its non-empty scriptSig and a normal input as an outpoint', () => {
    const coinbase = buildTransaction({ inputs: ['coinbase'], outputs: [{ script: RECIPIENT.script, valueSats: BigInt(1) }] });
    const spend = spendWithOpReturn();

    expect(authenticatedPopulationDetails(coinbase.getId(), nodeDetails(coinbase), 'mainnet').vin)
      .toStrictEqual([{ coinbase: COINBASE_SCRIPT_SIG_HEX }]);
    expect(authenticatedPopulationDetails(spend.getId(), nodeDetails(spend), 'mainnet').vin)
      .toStrictEqual([{ txid: PARENT_TXID, vout: 0 }]);
  });

  it('gives an output whose script has no address no address key', () => {
    const spend = spendWithOpReturn();
    const { vout } = authenticatedPopulationDetails(spend.getId(), nodeDetails(spend), 'mainnet');

    expect(vout[0]).toStrictEqual({ value: 0, n: 0, scriptHex: OP_RETURN_HEX });
    expect('address' in vout[0]).toBe(false);
    expect(vout[1].address).toBe(RECIPIENT.address);
  });

  it('copies only numeric chain-position metadata', () => {
    const spend = spendWithOpReturn();
    const numeric = authenticatedPopulationDetails(
      spend.getId(),
      nodeDetails(spend, { time: 1_700_000_000, blockheight: 900, confirmations: 3 }),
      'mainnet',
    );
    const nonNumeric = authenticatedPopulationDetails(
      spend.getId(),
      nodeDetails(spend, { time: '1700000000', blockheight: null }),
      'mainnet',
    );

    expect(numeric).toMatchObject({ time: 1_700_000_000, blockheight: 900, confirmations: 3 });
    expect(Object.keys(nonNumeric).sort()).toStrictEqual(['txid', 'vin', 'vout']);
  });

  it('never copies a verbose fee or input prevout', () => {
    const spend = spendWithOpReturn();
    const details = nodeDetails(spend);
    const projected = authenticatedPopulationDetails(spend.getId(), {
      ...details,
      fee: 0.5,
      vin: [{ ...details.vin[0], prevout: { value: 1, scriptPubKey: { address: ATTACKER.address } } }],
    }, 'mainnet');

    expect('fee' in projected).toBe(false);
    expect(projected.vin).toStrictEqual([{ txid: PARENT_TXID, vout: 0 }]);
  });

  it('returns exactly the byte projection and ignores client vin and vout', () => {
    const spend = spendWithOpReturn();
    const details = nodeDetails(spend, { blockheight: 900 });
    const clientVout = [
      { ...details.vout[0], scriptPubKey: { ...details.vout[0].scriptPubKey, address: ATTACKER.address } },
      { ...details.vout[1], value: 1.5 },
      { value: 2, n: 2, scriptPubKey: { address: ATTACKER.address } },
    ];

    expect(authenticatedPopulationDetails(spend.getId(), {
      ...details,
      fee: 0.5,
      vin: [{ txid: OTHER_PARENT_TXID, vout: 1, prevout: { value: 1, scriptPubKey: { address: ATTACKER.address } } }],
      vout: clientVout,
    }, 'mainnet')).toStrictEqual({
      txid: spend.getId(),
      blockheight: 900,
      vin: [{ txid: PARENT_TXID, vout: 0 }],
      vout: [
        { value: 0, n: 0, scriptHex: OP_RETURN_HEX },
        {
          value: 0.0009,
          n: 1,
          scriptHex: Buffer.from(RECIPIENT.script).toString('hex'),
          address: RECIPIENT.address,
        },
      ],
    });
  });

  it('rejects missing details as malformed', () => {
    expect(reasonOf(() => authenticatedPopulationDetails(PARENT_TXID, null, 'mainnet')))
      .toBe('malformed_raw_transaction');
  });

  it('rejects bytes that hash to a different txid', () => {
    const spend = spendWithOpReturn();
    expect(reasonOf(() => authenticatedPopulationDetails(PARENT_TXID, nodeDetails(spend), 'mainnet')))
      .toBe('txid_mismatch');
  });
});
