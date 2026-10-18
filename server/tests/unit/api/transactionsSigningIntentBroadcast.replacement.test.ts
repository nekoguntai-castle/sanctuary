/**
 * Broadcast-route spend derivation from the authenticated signing intent:
 * the RBF replacement link comes from the snapshot (a resumed approval-required
 * bump sends no `replacesTxid`), and a payjoin proposal is evaluated, reserved
 * and recorded at the sender's net amount, not the receiver's P + C output.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import * as bitcoin from 'bitcoinjs-lib';

const mocks = vi.hoisted(() => ({
  validateSignedArtifact: vi.fn(),
  broadcastAndSave: vi.fn(),
  findNetwork: vi.fn(),
  findAddressStrings: vi.fn(),
  findDraft: vi.fn(),
  findLinkedDraft: vi.fn(),
  evaluatePolicies: vi.fn(),
  recordUsage: vi.fn(),
  reserveEnforcedUsage: vi.fn(),
  releasePolicyUsage: vi.fn(),
  audit: vi.fn(),
  findVerifiedReplacement: vi.fn(),
  findHeldPolicyReservations: vi.fn(),
}));

vi.mock('../../../src/repositories/addressRepository', () => ({
  addressRepository: { findAddressStrings: mocks.findAddressStrings },
}));
vi.mock('../../../src/repositories/draftRepository', () => ({
  draftRepository: { findByIdInWallet: mocks.findDraft },
}));
vi.mock('../../../src/repositories/walletRepository', () => ({
  walletRepository: { findNetwork: mocks.findNetwork },
}));
vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId;
    req.user = { userId: 'user-1' };
    next();
  },
}));
vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user,
}));
vi.mock('../../../src/services/auditService', () => ({
  auditService: { logFromRequest: mocks.audit },
  AuditAction: { TRANSACTION_BROADCAST: 'broadcast', TRANSACTION_BROADCAST_FAILED: 'failed' },
  AuditCategory: { WALLET: 'wallet' },
}));
vi.mock('../../../src/services/vaultPolicy', () => ({
  policyEvaluationEngine: {
    evaluatePolicies: mocks.evaluatePolicies,
    recordUsage: mocks.recordUsage,
    reserveEnforcedUsage: mocks.reserveEnforcedUsage,
    releasePolicyUsage: mocks.releasePolicyUsage,
  },
}));
vi.mock('../../../src/services/bitcoin/signingIntent', async () => {
  const { deriveIntentSpend } = await vi.importActual<
    typeof import('../../../src/services/bitcoin/signingIntent/intentSpend')
  >('../../../src/services/bitcoin/signingIntent/intentSpend');
  return {
    validateSignedArtifact: mocks.validateSignedArtifact,
    findDraftBySigningIntent: mocks.findLinkedDraft,
    findHeldPolicyReservations: mocks.findHeldPolicyReservations,
    deriveIntentSpend,
  };
});
vi.mock('../../../src/services/bitcoin/transactions/broadcasting', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/bitcoin/transactions/broadcasting')>(
    '../../../src/services/bitcoin/transactions/broadcasting',
  );
  return { ...actual, broadcastAndSave: mocks.broadcastAndSave };
});
vi.mock('../../../src/services/bitcoin/transactions/replacementLink', () => ({
  findVerifiedReplacement: mocks.findVerifiedReplacement,
  selectCandidateOutpoints: (inputs: unknown[] | undefined, utxos: unknown[]) => (
    inputs && inputs.length > 0 ? inputs : utxos
  ),
}));
vi.mock('../../../src/services/bitcoin/utils', () => ({
  getNetwork: () => bitcoin.networks.testnet,
}));

import router from '../../../src/api/transactions/broadcasting';
import { errorHandler } from '../../../src/errors/errorHandler';

const WALLET_SCRIPT = '0014' + '22'.repeat(20);
const RECIPIENT_SCRIPT = '0014' + '33'.repeat(20);
const PEER_SCRIPT = '0014' + '44'.repeat(20);
const RECIPIENT = bitcoin.address.fromOutputScript(Buffer.from(RECIPIENT_SCRIPT, 'hex'), bitcoin.networks.testnet);
const SNAPSHOT_REPLACES = '5'.repeat(64);
const INTENT = { intentId: 'intent-1', intentDigest: 'a'.repeat(64) };

type SnapshotInput = { txid: string; vout: number; amountSats: string; scriptPubKeyHex: string; role: 'wallet' | 'payjoin_peer' };

const buildArtifact = (
  inputs: SnapshotInput[],
  outputs: Array<{ amountSats: string; scriptPubKeyHex: string }>,
  replacementTxid?: string,
) => ({
  walletId: 'wallet-1',
  network: 'testnet3',
  txid: '9'.repeat(64),
  rawTx: '00',
  intent: INTENT,
  snapshot: {
    version: 1,
    walletId: 'wallet-1',
    network: 'testnet3',
    transaction: {
      version: 2,
      locktime: 0,
      ...(replacementTxid && { replacementTxid }),
      inputs: inputs.map(({ txid, vout, amountSats, scriptPubKeyHex, role }) => ({
        txid, vout, sequence: 0xfffffffd, prevout: { amountSats, scriptPubKeyHex, role },
      })),
      outputs,
    },
  },
});

const walletInput: SnapshotInput = {
  txid: '1'.repeat(64), vout: 0, amountSats: '10000', scriptPubKeyHex: WALLET_SCRIPT, role: 'wallet',
};
/** A 9000-sat RBF bump of SNAPSHOT_REPLACES (or a legacy intent with no snapshot link). */
const bumpArtifact = (replacementTxid?: string) => buildArtifact(
  [walletInput],
  [{ amountSats: '9000', scriptPubKeyHex: RECIPIENT_SCRIPT }],
  replacementTxid,
);

const routes = [
  {
    name: 'transaction broadcast',
    path: '/api/v1/wallets/wallet-1/transactions/broadcast',
    body: (extra: Record<string, unknown> = {}) => ({ signedPsbtBase64: 'cHNi', ...INTENT, ...extra }),
  },
  {
    name: 'PSBT broadcast',
    path: '/api/v1/wallets/wallet-1/psbt/broadcast',
    body: (extra: Record<string, unknown> = {}) => ({ signedPsbt: 'cHNi', ...INTENT, ...extra }),
  },
];

describe('broadcast route spend derived from the signing intent', () => {
  let app: Express;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', router);
    app.use(errorHandler);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findLinkedDraft.mockResolvedValue(null);
    mocks.findNetwork.mockResolvedValue('testnet3');
    mocks.findAddressStrings.mockResolvedValue([]);
    mocks.evaluatePolicies.mockResolvedValue({ allowed: true });
    mocks.recordUsage.mockResolvedValue(undefined);
    mocks.reserveEnforcedUsage.mockResolvedValue({ ok: true, reservations: [] });
    mocks.releasePolicyUsage.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
    mocks.findVerifiedReplacement.mockResolvedValue(null);
    mocks.findHeldPolicyReservations.mockResolvedValue(null);
    mocks.broadcastAndSave.mockResolvedValue({ txid: '9'.repeat(64), broadcasted: true, persistenceStatus: 'complete' });
  });

  describe.each(routes)('RBF replacement link ($name)', (route) => {
    it('links a resumed bump that sends no replacesTxid through the snapshot', async () => {
      mocks.validateSignedArtifact.mockResolvedValue(bumpArtifact(SNAPSHOT_REPLACES));
      mocks.findVerifiedReplacement.mockResolvedValue({ id: 'original-id', label: null, amount: 8500n });

      const response = await request(app).post(route.path).send(route.body());

      expect(response.status).toBe(200);
      expect(mocks.findVerifiedReplacement).toHaveBeenCalledWith(
        'wallet-1', SNAPSHOT_REPLACES, [expect.objectContaining({ txid: '1'.repeat(64), vout: 0 })], undefined,
      );
      expect(mocks.evaluatePolicies).toHaveBeenCalledWith(expect.objectContaining({
        amount: 9000n, replacedAmount: 8500n, isReplacementBump: true,
      }));
      expect(mocks.reserveEnforcedUsage).toHaveBeenCalledWith({
        walletId: 'wallet-1', userId: 'user-1', amount: 9000n, replacedAmount: 8500n, isReplacementBump: true,
      });
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ replacesTxid: SNAPSHOT_REPLACES }),
      );
    });

    it('accepts a request replacesTxid that matches the snapshot', async () => {
      mocks.validateSignedArtifact.mockResolvedValue(bumpArtifact(SNAPSHOT_REPLACES));

      const response = await request(app).post(route.path).send(route.body({ replacesTxid: SNAPSHOT_REPLACES }));

      expect(response.status).toBe(200);
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ replacesTxid: SNAPSHOT_REPLACES }),
      );
    });

    it('refuses a request replacesTxid that disagrees with the snapshot before reserving policy usage', async () => {
      mocks.validateSignedArtifact.mockResolvedValue(bumpArtifact(SNAPSHOT_REPLACES));

      const response = await request(app).post(route.path).send(route.body({ replacesTxid: '6'.repeat(64) }));

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: 'Broadcast metadata does not match signing intent',
        details: { reason: 'metadata_mismatch', field: 'replacesTxid' },
      });
      expect(mocks.findHeldPolicyReservations).not.toHaveBeenCalled();
      expect(mocks.findVerifiedReplacement).not.toHaveBeenCalled();
      expect(mocks.evaluatePolicies).not.toHaveBeenCalled();
      expect(mocks.reserveEnforcedUsage).not.toHaveBeenCalled();
      expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
    });

    it('keeps the request replacesTxid for a legacy intent whose snapshot has no link', async () => {
      const legacyReplaces = '7'.repeat(64);
      mocks.validateSignedArtifact.mockResolvedValue(bumpArtifact());
      mocks.findVerifiedReplacement.mockResolvedValue({ id: 'original-id', label: null, amount: 8500n });

      const response = await request(app).post(route.path).send(route.body({ replacesTxid: legacyReplaces }));

      expect(response.status).toBe(200);
      expect(mocks.findVerifiedReplacement).toHaveBeenCalledWith('wallet-1', legacyReplaces, expect.any(Array), undefined);
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ replacesTxid: legacyReplaces }),
      );
    });

    it('treats a legacy intent with no request replacesTxid as a fresh spend', async () => {
      mocks.validateSignedArtifact.mockResolvedValue(bumpArtifact());

      const response = await request(app).post(route.path).send(route.body());

      expect(response.status).toBe(200);
      expect(mocks.findVerifiedReplacement).not.toHaveBeenCalled();
      expect(mocks.reserveEnforcedUsage).toHaveBeenCalledWith({ walletId: 'wallet-1', userId: 'user-1', amount: 9000n });
      expect(mocks.broadcastAndSave.mock.calls[0][1]).not.toHaveProperty('replacesTxid');
    });
  });

  it('links a resumed approved bump draft to the original it replaces', async () => {
    mocks.validateSignedArtifact.mockResolvedValue(bumpArtifact(SNAPSHOT_REPLACES));
    mocks.findVerifiedReplacement.mockResolvedValue({ id: 'original-id', label: null, amount: 8500n });
    mocks.findLinkedDraft.mockResolvedValue({
      id: 'draft-1', status: 'unsigned', approvalStatus: 'approved',
      signingIntentId: INTENT.intentId, signingIntentDigest: INTENT.intentDigest, signedPsbtBase64: 'cHNi',
      recipient: RECIPIENT, effectiveAmount: 9000n, fee: 1000n,
      selectedUtxoIds: [`${'1'.repeat(64)}:0`], label: null, memo: null,
    });
    // Approval-required at the full amount: satisfied by the approved draft for this intent.
    mocks.evaluatePolicies.mockResolvedValue({ allowed: true, triggered: [{ action: 'approval_required' }] });

    const response = await request(app).post(routes[0].path).send(routes[0].body());

    expect(response.status).toBe(200);
    expect(mocks.reserveEnforcedUsage).toHaveBeenCalledWith(expect.objectContaining({
      replacedAmount: 8500n, isReplacementBump: true,
    }));
    expect(mocks.broadcastAndSave).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ replacesTxid: SNAPSHOT_REPLACES, draftId: 'draft-1' }),
    );
  });

  describe('payjoin proposal (receiver contribution C = 5000, payment P = 9000)', () => {
    const PAYMENT = 9000;
    const peerInput: SnapshotInput = {
      txid: '2'.repeat(64), vout: 3, amountSats: '5000', scriptPubKeyHex: PEER_SCRIPT, role: 'payjoin_peer',
    };
    // The receiver output is raised from P to P + C; fee = 15000 - 14000.
    const proposal = buildArtifact([walletInput, peerInput], [{ amountSats: '14000', scriptPubKeyHex: RECIPIENT_SCRIPT }]);
    // What the web client sends after a payjoin: the proposal's outpoints and fee, amount P.
    const clientBody = routes[0].body({
      recipient: RECIPIENT,
      amount: PAYMENT,
      fee: 1000,
      utxos: [{ txid: walletInput.txid, vout: walletInput.vout }, { txid: peerInput.txid, vout: peerInput.vout }],
    });

    beforeEach(() => {
      mocks.validateSignedArtifact.mockResolvedValue(proposal);
      // amountAbove 10000 lies between P and P + C.
      mocks.evaluatePolicies.mockImplementation(async (input: { amount: bigint }) => (
        input.amount > 10000n
          ? { allowed: true, triggered: [{ action: 'approval_required' }] }
          : { allowed: true, triggered: [] }
      ));
    });

    it('evaluates, reserves and records the sender net amount P', async () => {
      const response = await request(app).post(routes[0].path).send(clientBody);

      expect(response.status).toBe(200);
      expect(mocks.evaluatePolicies).toHaveBeenCalledWith(expect.objectContaining({
        amount: BigInt(PAYMENT), outputs: [{ address: RECIPIENT, amount: 14000 }],
      }));
      expect(mocks.reserveEnforcedUsage).toHaveBeenCalledWith({
        walletId: 'wallet-1', userId: 'user-1', amount: BigInt(PAYMENT),
      });
      // persistTransaction records a sent transaction as -(amount + fee) = -(P + fee).
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(proposal, expect.objectContaining({
        recipient: RECIPIENT, amount: PAYMENT, fee: 1000,
      }));
      expect(mocks.recordUsage).toHaveBeenCalledWith('wallet-1', 'user-1', BigInt(PAYMENT));
    });

    it('refuses a client body that reports P + C as the amount', async () => {
      const response = await request(app).post(routes[0].path).send({ ...clientBody, amount: 14000 });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ details: { reason: 'metadata_mismatch' } });
      expect(mocks.reserveEnforcedUsage).not.toHaveBeenCalled();
    });
  });
});
