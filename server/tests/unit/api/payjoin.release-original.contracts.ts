import { beforeEach, describe, expect, it, type MockInstance } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

type ReleaseOriginalContext = {
  getApp: () => Express;
  mocks: {
    findIntentById: MockInstance;
    restorePayjoinOriginal: MockInstance;
    findDraftBySigningIntent: MockInstance;
    walletUserFindFirst: MockInstance;
    walletFindFirst: MockInstance;
    processPayjoinRequest: MockInstance;
  };
  walletId: string;
};

const DIGEST = 'a'.repeat(64);

export function registerPayjoinReleaseOriginalContracts({ getApp, mocks, walletId }: ReleaseOriginalContext) {
  const body = { walletId, intentId: 'intent-1', intentDigest: DIGEST };
  const release = (overrides: Record<string, unknown> = {}, userId = 'user-123') => request(getApp())
    .post('/api/v1/payjoin/release-original')
    .set('Authorization', 'Bearer test-token')
    .set('x-test-user-id', userId)
    .send({ ...body, ...overrides });
  const storedOriginal = (overrides: Record<string, unknown> = {}) => ({
    id: 'intent-1', walletId, snapshotDigest: DIGEST, supersededById: 'intent-2', ...overrides,
  });

  describe('POST /release-original', () => {
    beforeEach(() => {
      mocks.findIntentById.mockReset().mockResolvedValue(storedOriginal());
      mocks.restorePayjoinOriginal.mockReset().mockResolvedValue('restored');
      mocks.findDraftBySigningIntent.mockReset().mockResolvedValue(null);
    });

    it('restores a superseded original after checking drafts for both intents', async () => {
      const res = await release();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ restored: true });
      expect(mocks.findIntentById).toHaveBeenCalledWith('intent-1');
      expect(mocks.findDraftBySigningIntent).toHaveBeenNthCalledWith(1, walletId, 'intent-1');
      expect(mocks.findDraftBySigningIntent).toHaveBeenNthCalledWith(2, walletId, 'intent-2');
      expect(mocks.restorePayjoinOriginal).toHaveBeenCalledWith('intent-1', walletId, DIGEST);
      expect(mocks.processPayjoinRequest).not.toHaveBeenCalled();
    });

    it('answers restored:false for an original that is not superseded, checking only its own drafts', async () => {
      mocks.findIntentById.mockResolvedValueOnce(storedOriginal({ supersededById: null }));
      mocks.restorePayjoinOriginal.mockResolvedValueOnce('not_superseded');

      const res = await release();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ restored: false });
      expect(mocks.findDraftBySigningIntent).toHaveBeenCalledOnce();
      expect(mocks.findDraftBySigningIntent).toHaveBeenCalledWith(walletId, 'intent-1');
    });

    it('refuses while the proposal broadcast is in flight', async () => {
      mocks.restorePayjoinOriginal.mockResolvedValueOnce('in_flight');

      const res = await release();

      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ reason: 'payjoin_broadcast_in_progress' });
    });

    it.each(['not_found', 'not_payjoin'])('maps a %s restore result to missing_intent', async (result) => {
      mocks.restorePayjoinOriginal.mockResolvedValueOnce(result);

      const res = await release();

      expect(res.status).toBe(400);
      expect(res.body.details).toMatchObject({ reason: 'missing_intent' });
    });

    it.each([
      ['a missing intent', null],
      ['an intent from another wallet', storedOriginal({ walletId: 'wallet-other' })],
      ['an intent with another digest', storedOriginal({ snapshotDigest: 'b'.repeat(64) })],
    ])('refuses %s before restoring', async (_name, stored) => {
      mocks.findIntentById.mockResolvedValueOnce(stored);

      const res = await release();

      expect(res.status).toBe(400);
      expect(res.body.details).toMatchObject({ reason: 'missing_intent' });
      expect(mocks.findDraftBySigningIntent).not.toHaveBeenCalled();
      expect(mocks.restorePayjoinOriginal).not.toHaveBeenCalled();
    });

    it.each([
      ['the original', 'intent-1'],
      ['the replacement', 'intent-2'],
    ])('refuses when a draft is bound to %s before restoring', async (_name, boundId) => {
      mocks.findDraftBySigningIntent.mockImplementation(async (_walletId: string, intentId: string) => (
        intentId === boundId ? { id: 'draft-1' } : null
      ));

      const res = await release();

      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ reason: 'draft_bound_intent' });
      expect(mocks.restorePayjoinOriginal).not.toHaveBeenCalled();
    });

    it.each([
      ['an extra field', { signedPsbt: 'cHNidP8=' }],
      ['a missing intentId', { intentId: undefined }],
      ['a malformed digest', { intentDigest: 'xyz' }],
    ])('rejects %s with 400 before any lookup', async (_name, overrides) => {
      const res = await release(overrides);

      expect(res.status).toBe(400);
      expect(mocks.findIntentById).not.toHaveBeenCalled();
      expect(mocks.restorePayjoinOriginal).not.toHaveBeenCalled();
    });

    it('requires wallet edit access', async () => {
      mocks.walletUserFindFirst.mockResolvedValueOnce({ role: 'viewer' });

      const res = await release({}, 'viewer-user');

      expect(res.status).toBe(403);
      expect(mocks.restorePayjoinOriginal).not.toHaveBeenCalled();
    });

    it('conceals a wallet the user cannot access', async () => {
      mocks.walletFindFirst.mockResolvedValueOnce(null);

      const res = await release();

      expect(res.status).toBe(404);
      expect(mocks.restorePayjoinOriginal).not.toHaveBeenCalled();
    });

    it('requires authentication', async () => {
      const res = await request(getApp()).post('/api/v1/payjoin/release-original').send(body);

      expect(res.status).toBe(401);
      expect(mocks.processPayjoinRequest).not.toHaveBeenCalled();
    });
  });
}
