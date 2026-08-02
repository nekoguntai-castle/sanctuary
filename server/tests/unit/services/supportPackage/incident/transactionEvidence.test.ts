import { describe, expect, it, vi } from 'vitest';
import { readIncidentTransactionEvidence } from '../../../../../src/services/supportPackage/incident/transactionEvidence';
import type { IncidentSelectors } from '../../../../../src/services/supportPackage/incident/types';
import { transactionRepository } from '../../../../../src/repositories';

const selectors: IncidentSelectors = {
  txid: 'a'.repeat(64),
  senderWalletId: 'sender-wallet-secret',
  receiverWalletId: 'receiver-wallet-secret',
  approximateIncidentAt: new Date('2026-08-02T12:00:00.000Z'),
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    type: 'sent',
    createdAt: new Date('2026-08-02T12:00:00.000Z'),
    wallet: { network: 'mainnet' },
    address: null,
    ...overrides,
  };
}

describe('incident transaction evidence', () => {
  it('queries only the two exact wallet/txid rows and emits categorical roles', async () => {
    const findByTxid = vi.fn()
      .mockResolvedValueOnce(row({
        type: 'sent',
        createdAt: new Date('2026-08-02T11:50:00.000Z'),
      }))
      .mockResolvedValueOnce(row({
        type: 'received',
        createdAt: new Date('2026-08-02T12:10:00.000Z'),
        address: {
          walletId: selectors.receiverWalletId,
          createdAt: new Date('2026-08-02T11:55:00.000Z'),
        },
      }));

    const result = await readIncidentTransactionEvidence(selectors, { findByTxid });

    expect(findByTxid.mock.calls).toEqual([
      [selectors.txid, selectors.senderWalletId, {
        select: {
          type: true,
          createdAt: true,
          wallet: { select: { network: true } },
          address: { select: { walletId: true, createdAt: true } },
        },
      }],
      [selectors.txid, selectors.receiverWalletId, {
        select: {
          type: true,
          createdAt: true,
          wallet: { select: { network: true } },
          address: { select: { walletId: true, createdAt: true } },
        },
      }],
    ]);
    expect(result.roles).toEqual([
      {
        role: 'sender',
        expectedDirection: 'sent',
        lookupStatus: 'observed',
        transactionRow: {
          present: 'observed_true',
          directionMatches: 'observed_true',
          timing: 'within_window',
        },
      },
      {
        role: 'receiver',
        expectedDirection: 'received',
        lookupStatus: 'observed',
        transactionRow: {
          present: 'observed_true',
          directionMatches: 'observed_true',
          timing: 'within_window',
        },
      },
    ]);
    expect(result.receiverMatch).toEqual({
      ownsSelectedOutput: 'observed_true',
      networkMatches: 'observed_true',
      addressTiming: 'within_window',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(selectors.txid);
    expect(serialized).not.toContain(selectors.senderWalletId);
    expect(serialized).not.toContain(selectors.receiverWalletId);
  });

  it('distinguishes missing rows, wrong direction, and unavailable lookup', async () => {
    const findByTxid = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({
        type: 'sent',
        createdAt: new Date('2026-08-02T12:00:00.000Z'),
      }));
    const result = await readIncidentTransactionEvidence(selectors, { findByTxid });

    expect(result.roles[0].transactionRow).toEqual({
      present: 'observed_false',
      directionMatches: 'not_observed',
      timing: 'unknown',
    });
    expect(result.roles[1].transactionRow.directionMatches).toBe('observed_false');

    findByTxid.mockReset();
    findByTxid.mockRejectedValue(new Error(`poison-${selectors.txid}`));
    const unavailable = await readIncidentTransactionEvidence(selectors, { findByTxid });
    expect(unavailable.roles.map((entry) => entry.lookupStatus)).toEqual([
      'unavailable',
      'unavailable',
    ]);
    expect(JSON.stringify(unavailable)).not.toContain('poison');
  });

  it.each([
    ['predates_incident', '2026-08-02T11:44:59.999Z'],
    ['within_window', '2026-08-02T11:45:00.000Z'],
    ['within_window', '2026-08-02T12:15:00.000Z'],
    ['postdates_incident', '2026-08-02T12:15:00.001Z'],
  ] as const)('categorizes row time as %s', async (expected, createdAt) => {
    const findByTxid = vi.fn().mockResolvedValue(row({
      type: 'sent',
      createdAt: new Date(createdAt),
    }));
    const result = await readIncidentTransactionEvidence(selectors, { findByTxid });
    expect(result.roles[0].transactionRow.timing).toBe(expected);
  });

  it('uses unknown timing for an invalid stored or incident date', async () => {
    const findByTxid = vi.fn().mockResolvedValue(row({
      type: 'sent',
      createdAt: new Date(Number.NaN),
    }));
    const invalidRow = await readIncidentTransactionEvidence(selectors, { findByTxid });
    expect(invalidRow.roles[0].transactionRow.timing).toBe('unknown');

    const invalidIncident = await readIncidentTransactionEvidence(
      { ...selectors, approximateIncidentAt: new Date(Number.NaN) },
      {
        findByTxid: vi.fn().mockResolvedValue(row({
          type: 'sent',
          createdAt: new Date('2026-08-02T12:00:00.000Z'),
        })),
      },
    );
    expect(invalidIncident.roles[0].transactionRow.timing).toBe('unknown');
  });

  it('categorizes receiver ownership, network mismatch, and address timing', async () => {
    const findByTxid = vi.fn()
      .mockResolvedValueOnce(row({ wallet: { network: 'mainnet' } }))
      .mockResolvedValueOnce(row({
        type: 'received',
        wallet: { network: 'testnet4' },
        address: {
          walletId: 'different-wallet',
          createdAt: new Date('2026-08-02T11:00:00.000Z'),
        },
      }));
    const result = await readIncidentTransactionEvidence(selectors, { findByTxid });
    expect(result.receiverMatch).toEqual({
      ownsSelectedOutput: 'observed_false',
      networkMatches: 'observed_false',
      addressTiming: 'predates_incident',
    });
  });

  it('uses not-observed receiver-match categories when exact rows lack evidence', async () => {
    const result = await readIncidentTransactionEvidence(selectors, {
      findByTxid: vi.fn().mockResolvedValue(null),
    });
    expect(result.receiverMatch).toEqual({
      ownsSelectedOutput: 'not_observed',
      networkMatches: 'not_observed',
      addressTiming: 'unknown',
    });
  });

  it('uses the bounded production repository adapter when none is injected', async () => {
    const findByTxid = vi.spyOn(transactionRepository, 'findByTxid').mockResolvedValue(null);
    await readIncidentTransactionEvidence(selectors);
    expect(findByTxid).toHaveBeenCalledTimes(2);
    expect(findByTxid).toHaveBeenCalledWith(
      selectors.txid,
      selectors.senderWalletId,
      expect.objectContaining({ select: expect.any(Object) }),
    );
    findByTxid.mockRestore();
  });
});
