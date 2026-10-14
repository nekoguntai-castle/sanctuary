import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { ConflictError, InvalidInputError } from '../../../../src/errors/ApiError';
import { PreNetworkBroadcastRejectionError } from '../../../../src/services/bitcoin/transactions/broadcasting';
import {
  app,
  DefiniteBroadcastRejectionError,
  mockBroadcastAndSave,
  mockEvaluatePolicies,
  mockFindHeldPolicyReservations,
  mockReleasePolicyUsage,
  mockReserveEnforcedUsage,
  walletId,
} from './transactionsHttpRoutesTestHarness';

type FailureTag =
  | { claimed: false; releasedToReady: false }
  | { claimed: true; priorState: 'ready' | 'resumed' | 'stalled'; releasedToReady: boolean };

const body = { signedPsbtBase64: 'cHNi', intentId: 'intent-http', intentDigest: 'a'.repeat(64) };
const txid = 'd'.repeat(64);
const reservations = [{ windowId: 'w1', amount: BigInt(20000) }];
const persistedReservations = [{ windowId: 'w1', amount: '20000' }];

const tagged = <T extends object>(error: T, broadcastFailure: FailureTag): T =>
  Object.assign(error, { broadcastFailure });
const preNetwork = (reason = 'metadata_mismatch') => new PreNetworkBroadcastRejectionError(
  new InvalidInputError('Signing intent does not match the broadcast artifact', 'intentId', { reason }),
);
const unknownOutcome = () => new Error('Broadcast outcome is unknown: connection lost');

const broadcast = () => request(app).post(`/api/v1/wallets/${walletId}/transactions/broadcast`).send(body);

export function registerTransactionHttpBroadcastRetryTests(): void {
  describe('broadcast retry policy reservations', () => {
    it('reuses the reservation held by an unknown-outcome attempt instead of reserving again', async () => {
      mockReserveEnforcedUsage.mockResolvedValueOnce({ ok: true, reservations });
      mockBroadcastAndSave.mockRejectedValueOnce(
        tagged(unknownOutcome(), { claimed: true, priorState: 'ready', releasedToReady: false }),
      );
      expect((await broadcast()).status).toBe(500);

      mockFindHeldPolicyReservations.mockResolvedValueOnce(reservations);
      const retry = await broadcast();

      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      expect(mockFindHeldPolicyReservations).toHaveBeenCalledWith('intent-http', txid);
      expect(mockReserveEnforcedUsage).toHaveBeenCalledOnce();
      expect(mockReleasePolicyUsage).not.toHaveBeenCalled();
      expect(mockEvaluatePolicies).toHaveBeenLastCalledWith(expect.objectContaining({
        amount: BigInt(20000), replacedAmount: BigInt(20000), isReplacementBump: true,
      }));
      expect(mockBroadcastAndSave).toHaveBeenNthCalledWith(
        1, expect.anything(), expect.objectContaining({ policyReservations: persistedReservations }),
      );
      expect(mockBroadcastAndSave).toHaveBeenNthCalledWith(
        2, expect.anything(), expect.objectContaining({ policyReservations: persistedReservations }),
        { resumeOnly: true },
      );
    });

    it('lets a reusing retry pass a velocity cap the original attempt reached', async () => {
      mockFindHeldPolicyReservations.mockResolvedValueOnce(reservations);
      mockEvaluatePolicies.mockImplementation(async (input: { isReplacementBump?: boolean }) => ({
        allowed: input.isReplacementBump === true, triggered: [],
      }));

      const response = await broadcast();

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(mockReserveEnforcedUsage).not.toHaveBeenCalled();
    });

    it('refuses before the network when the intent returned to ready between the held read and the claim', async () => {
      mockFindHeldPolicyReservations.mockResolvedValueOnce(reservations);
      mockBroadcastAndSave.mockRejectedValueOnce(tagged(preNetwork(), { claimed: false, releasedToReady: false }));

      const raced = await broadcast();

      expect(raced.status).toBe(400);
      expect(raced.body.details).toMatchObject({ reason: 'metadata_mismatch' });
      expect(mockReserveEnforcedUsage).not.toHaveBeenCalled();
      expect(mockReleasePolicyUsage).not.toHaveBeenCalled();

      const further = await broadcast();

      expect(further.status, JSON.stringify(further.body)).toBe(200);
      expect(mockReserveEnforcedUsage).toHaveBeenCalledOnce();
      expect(mockBroadcastAndSave).toHaveBeenLastCalledWith(
        expect.anything(), expect.objectContaining({ policyReservations: [] }),
      );
    });

    it('releases only the fresh reservation when a fresh claim finds an attempt that already holds reservations', async () => {
      const fresh = [{ windowId: 'w1', amount: BigInt(20000) }];
      mockReserveEnforcedUsage.mockResolvedValueOnce({ ok: true, reservations: fresh });
      mockBroadcastAndSave.mockRejectedValueOnce(tagged(new PreNetworkBroadcastRejectionError(
        new ConflictError('Signing intent broadcast is already in progress', undefined, { reason: 'duplicate_submission' }),
      ), { claimed: false, releasedToReady: false }));

      expect((await broadcast()).status).toBe(409);
      expect(mockReleasePolicyUsage).toHaveBeenCalledOnce();
      expect(mockReleasePolicyUsage.mock.calls[0][0]).toBe(fresh);

      mockFindHeldPolicyReservations.mockResolvedValueOnce(reservations);
      const retry = await broadcast();

      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      expect(mockReserveEnforcedUsage).toHaveBeenCalledOnce();
      expect(mockReleasePolicyUsage).toHaveBeenCalledOnce();
      expect(mockBroadcastAndSave).toHaveBeenLastCalledWith(
        expect.anything(), expect.objectContaining({ policyReservations: persistedReservations }), { resumeOnly: true },
      );
    });

    it('never releases held reservations, whatever the failure', async () => {
      mockFindHeldPolicyReservations.mockResolvedValueOnce(reservations);
      mockBroadcastAndSave.mockRejectedValueOnce(
        tagged(preNetwork(), { claimed: true, priorState: 'ready', releasedToReady: true }),
      );

      expect((await broadcast()).status).toBe(400);
      expect(mockReleasePolicyUsage).not.toHaveBeenCalled();
    });

    it.each([
      ['an untagged definite rejection', () => new DefiniteBroadcastRejectionError('node rejected transaction')],
      ['an untagged non-pre-network error', () => new Error('persistence failed')],
      ['an unknown outcome on a first claim', () => tagged(unknownOutcome(), {
        claimed: true, priorState: 'ready', releasedToReady: false,
      })],
      ['a definite rejection whose release to ready failed', () => tagged(
        new DefiniteBroadcastRejectionError('node rejected transaction'),
        { claimed: true, priorState: 'ready', releasedToReady: false },
      )],
      ['a resumed claim with a definite rejection', () => tagged(
        new DefiniteBroadcastRejectionError('node rejected transaction'),
        { claimed: true, priorState: 'resumed', releasedToReady: false },
      )],
      ['a legacy unknown intent whose retry fails the replacement link', () => tagged(
        preNetwork('replacement_link'), { claimed: true, priorState: 'resumed', releasedToReady: false },
      )],
    ])('retains fresh reservations for %s', async (_label, makeError) => {
      mockReserveEnforcedUsage.mockResolvedValueOnce({ ok: true, reservations });
      mockBroadcastAndSave.mockRejectedValueOnce(makeError());

      const response = await broadcast();

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mockReleasePolicyUsage).not.toHaveBeenCalled();
    });

    it.each([
      ['no claim was taken', () => tagged(preNetwork('hardware'), { claimed: false, releasedToReady: false })],
      ['an untagged pre-network rejection', () => preNetwork('hardware')],
      ['a replacement-link failure released a first claim to ready', () => tagged(
        preNetwork('replacement_link'), { claimed: true, priorState: 'ready', releasedToReady: true },
      )],
    ])('releases fresh reservations when %s', async (_label, makeError) => {
      mockReserveEnforcedUsage.mockResolvedValueOnce({ ok: true, reservations });
      mockBroadcastAndSave.mockRejectedValueOnce(makeError());

      expect((await broadcast()).status).toBe(400);
      expect(mockReleasePolicyUsage).toHaveBeenCalledWith(reservations);
    });
  });
}
