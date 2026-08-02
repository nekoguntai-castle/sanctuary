import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockAudit,
  mockGenerate,
  mockGenerateIncident,
  mockRelease,
  mockLease,
  mockWarn,
  mockCaptureArm,
  mockCaptureRead,
  mockCaptureStatus,
  mockCaptureTeardown,
  captureAvailable,
} = vi.hoisted(() => ({
  mockAudit: vi.fn(),
  mockGenerate: vi.fn(),
  mockGenerateIncident: vi.fn(),
  mockRelease: vi.fn(),
  mockLease: vi.fn(),
  mockWarn: vi.fn(),
  mockCaptureArm: vi.fn(),
  mockCaptureRead: vi.fn(),
  mockCaptureStatus: vi.fn(),
  mockCaptureTeardown: vi.fn(),
  captureAvailable: { value: true },
}));

vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user,
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock('../../../../src/services/supportPackage', () => ({
  generateSerializedSupportPackage: (...args: unknown[]) => mockGenerate(...args),
  generateSerializedIncidentProfile: (...args: unknown[]) => mockGenerateIncident(...args),
}));
vi.mock('../../../../src/services/supportPackage/captureRuntime', () => ({
  getControlledCaptureService: () => captureAvailable.value ? ({
    arm: (...args: unknown[]) => mockCaptureArm(...args),
    read: (...args: unknown[]) => mockCaptureRead(...args),
    status: (...args: unknown[]) => mockCaptureStatus(...args),
    teardown: (...args: unknown[]) => mockCaptureTeardown(...args),
  }) : null,
}));
vi.mock('../../../../src/services/supportPackage/generationLease', () => ({
  acquireSupportPackageGenerationLease: (...args: unknown[]) => mockLease(...args),
}));
vi.mock('../../../../src/services/auditService', () => ({
  AuditAction: {
    SUPPORT_PACKAGE_GENERATE: 'admin.support_package_generate',
    SUPPORT_INCIDENT_PROFILE_GENERATE: 'admin.support_incident_profile_generate',
    SUPPORT_INCIDENT_CAPTURE_ARM: 'admin.support_incident_capture_arm',
    SUPPORT_INCIDENT_CAPTURE_TEARDOWN: 'admin.support_incident_capture_teardown',
  },
  AuditCategory: { ADMIN: 'admin' },
  auditService: { logFromRequest: (...args: unknown[]) => mockAudit(...args) },
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

import { errorHandler } from '../../../../src/errors/errorHandler';
import supportPackageRouter from '../../../../src/api/admin/supportPackage';

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1/admin', supportPackageRouter);
  instance.use(errorHandler);
  return instance;
}

describe('Admin Support Package Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRelease.mockResolvedValue(undefined);
    mockLease.mockResolvedValue({ status: 'acquired', release: mockRelease });
    mockGenerate.mockResolvedValue(Buffer.from('{"profile":"shareable_aggregate"}'));
    mockGenerateIncident.mockResolvedValue(Buffer.from('{"profile":"single_incident"}'));
    mockCaptureRead.mockResolvedValue({ status: { state: 'inactive' } });
    mockCaptureStatus.mockResolvedValue({ state: 'inactive' });
    mockCaptureArm.mockResolvedValue({ state: 'ready', expiresIn: '10_to_15_minutes' });
    mockCaptureTeardown.mockResolvedValue({ state: 'inactive' });
    captureAvailable.value = true;
    mockAudit.mockResolvedValue(undefined);
  });

  it('requires explicit aggregate-activity confirmation', async () => {
    const response = await request(app()).post('/api/v1/admin/support-package').send({});

    expect(response.status).toBe(400);
    expect(response.headers).not.toHaveProperty('content-disposition');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('sends the exact validated bytes only after generation succeeds', async () => {
    const response = await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(200);

    expect(response.text).toBe('{"profile":"shareable_aggregate"}');
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="sanctuary-support-/);
    expect(response.headers['content-length']).toBe('33');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      'admin.support_package_generate',
      'admin',
      { details: { profile: 'shareable_aggregate', version: '2.0.0' } },
    );
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('fails atomically before attachment headers on privacy failure', async () => {
    mockGenerate.mockRejectedValue(new Error('postgres://private:secret@db/internal'));

    const response = await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(503);

    expect(response.headers).not.toHaveProperty('content-disposition');
    expect(response.body).toEqual({
      error: 'support_package_unavailable',
      message: 'The privacy-safe support package could not be generated.',
    });
    expect(JSON.stringify(response.body)).not.toContain('private');
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it.each([
    ['busy', 429, 'support_package_generation_in_progress'],
    ['unavailable', 503, 'support_package_unavailable'],
  ] as const)('maps %s lease state to a fixed response', async (status, expectedStatus, code) => {
    mockLease.mockResolvedValue({ status });

    const response = await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(expectedStatus);

    expect(response.body.error).toBe(code);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('does not let aggregate audit failure corrupt safe bytes', async () => {
    mockAudit.mockRejectedValue(new Error('audit unavailable'));

    await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(200);

    expect(mockRelease).toHaveBeenCalledOnce();
    expect(mockWarn).toHaveBeenCalledWith(
      'Support package audit write failed',
      { code: 'audit_unavailable' },
    );
  });

  it('does not let lease release failure corrupt safe bytes', async () => {
    mockRelease.mockRejectedValue(new Error('private redis detail'));

    const response = await request(app())
      .post('/api/v1/admin/support-package')
      .send({ confirmShareableAggregate: true })
      .expect(200);

    expect(response.text).toBe('{"profile":"shareable_aggregate"}');
    expect(mockWarn).toHaveBeenCalledWith(
      'Support package generation lease release failed',
      { code: 'lease_release_failed' },
    );
  });

  const incidentSelectors = {
    txid: 'a'.repeat(64),
    senderWalletId: 'sender-wallet',
    receiverWalletId: 'receiver-wallet',
    approximateIncidentTime: '2026-08-02T18:00:00.000Z',
  };

  it('generates an incident attachment without returning or auditing selectors', async () => {
    const response = await request(app())
      .post('/api/v1/admin/support-package/incident')
      .send({ ...incidentSelectors, confirmIncidentProfile: true })
      .expect(200);

    expect(response.text).toBe('{"profile":"single_incident"}');
    expect(response.headers['content-type']).toMatch(
      /application\/vnd\.sanctuary\.support-incident\.v1\+json/,
    );
    expect(response.headers['content-disposition']).toMatch(/sanctuary-support-incident-/);
    expect(mockGenerateIncident).toHaveBeenCalledWith({
      txid: incidentSelectors.txid,
      senderWalletId: incidentSelectors.senderWalletId,
      receiverWalletId: incidentSelectors.receiverWalletId,
      approximateIncidentAt: new Date(incidentSelectors.approximateIncidentTime),
    }, { status: { state: 'inactive' } });
    expect(mockAudit).toHaveBeenLastCalledWith(
      expect.anything(),
      'admin.support_incident_profile_generate',
      'admin',
      { details: { profile: 'single_incident', version: '1.0.0' } },
    );
    expect(JSON.stringify(response.body)).not.toContain(incidentSelectors.senderWalletId);
  });

  it('requires valid distinct selectors and explicit incident confirmation', async () => {
    await request(app())
      .post('/api/v1/admin/support-package/incident')
      .send({ ...incidentSelectors, receiverWalletId: incidentSelectors.senderWalletId })
      .expect(400);
    expect(mockGenerateIncident).not.toHaveBeenCalled();
  });

  it('canonicalizes accepted uppercase transaction IDs for capture matching and lookup', async () => {
    const uppercase = { ...incidentSelectors, txid: 'B'.repeat(64) };
    await request(app())
      .post('/api/v1/admin/support-package/incident')
      .send({ ...uppercase, confirmIncidentProfile: true })
      .expect(200);
    const canonical = { ...uppercase, txid: 'b'.repeat(64) };
    expect(mockCaptureRead).toHaveBeenCalledWith({
      txid: canonical.txid,
      senderWalletId: canonical.senderWalletId,
      receiverWalletId: canonical.receiverWalletId,
    });
    expect(mockGenerateIncident).toHaveBeenCalledWith(expect.objectContaining({
      txid: canonical.txid,
    }), expect.anything());

    await request(app())
      .post('/api/v1/admin/support-package/incident-capture')
      .send({ ...uppercase, confirmIncidentCapture: true })
      .expect(201);
    expect(mockCaptureArm).toHaveBeenCalledWith({
      txid: canonical.txid,
      senderWalletId: canonical.senderWalletId,
      receiverWalletId: canonical.receiverWalletId,
    });
  });

  it.each([
    ['busy', 429, 'support_package_generation_in_progress'],
    ['unavailable', 503, 'incident_profile_unavailable'],
  ] as const)('maps incident %s lease state safely', async (leaseState, status, error) => {
    mockLease.mockResolvedValue({ status: leaseState });
    const response = await request(app())
      .post('/api/v1/admin/support-package/incident')
      .send({ ...incidentSelectors, confirmIncidentProfile: true })
      .expect(status);
    expect(response.body.error).toBe(error);
    expect(mockGenerateIncident).not.toHaveBeenCalled();
  });

  it('fails incident generation atomically and contains audit/release failures', async () => {
    mockGenerateIncident.mockRejectedValueOnce(new Error('private selector poison'));
    const failed = await request(app())
      .post('/api/v1/admin/support-package/incident')
      .send({ ...incidentSelectors, confirmIncidentProfile: true })
      .expect(503);
    expect(failed.headers).not.toHaveProperty('content-disposition');
    expect(failed.body.error).toBe('incident_profile_unavailable');

    mockAudit.mockRejectedValueOnce(new Error('audit failed'));
    mockRelease.mockRejectedValueOnce(new Error('release failed'));
    await request(app())
      .post('/api/v1/admin/support-package/incident')
      .send({ ...incidentSelectors, confirmIncidentProfile: true })
      .expect(200);
    expect(mockWarn).toHaveBeenCalledWith(
      'Incident profile audit write failed',
      { code: 'audit_unavailable' },
    );
    expect(mockWarn).toHaveBeenCalledWith(
      'Incident profile generation lease release failed',
      { code: 'lease_release_failed' },
    );
  });

  it('arms, reports, and tears down capture using categorical responses', async () => {
    const armed = await request(app())
      .post('/api/v1/admin/support-package/incident-capture')
      .send({ ...incidentSelectors, confirmIncidentCapture: true })
      .expect(201);
    expect(armed.body).toEqual({ state: 'ready', expiresIn: '10_to_15_minutes' });
    expect(mockCaptureArm).toHaveBeenCalledWith({
      txid: incidentSelectors.txid,
      senderWalletId: incidentSelectors.senderWalletId,
      receiverWalletId: incidentSelectors.receiverWalletId,
    });

    await request(app()).get('/api/v1/admin/support-package/incident-capture').expect(200, {
      state: 'inactive',
    });
    await request(app())
      .delete('/api/v1/admin/support-package/incident-capture')
      .send({ confirmIncidentCaptureTeardown: true })
      .expect(200, { state: 'inactive' });

    const auditBytes = JSON.stringify(mockAudit.mock.calls.map(call => call.slice(1)));
    expect(auditBytes).not.toContain(incidentSelectors.txid);
    expect(auditBytes).not.toContain(incidentSelectors.senderWalletId);
    expect(auditBytes).not.toContain(incidentSelectors.receiverWalletId);
  });

  it('returns fixed capture-unavailable errors and categorical invalid states', async () => {
    captureAvailable.value = false;
    await request(app()).get('/api/v1/admin/support-package/incident-capture').expect(503, {
      error: 'incident_capture_unavailable',
      message: 'The controlled incident capture service is unavailable.',
    });
    await request(app())
      .post('/api/v1/admin/support-package/incident-capture')
      .send({ ...incidentSelectors, confirmIncidentCapture: true })
      .expect(503);
    await request(app())
      .delete('/api/v1/admin/support-package/incident-capture')
      .send({ confirmIncidentCaptureTeardown: true })
      .expect(503);

    captureAvailable.value = true;
    mockCaptureArm.mockResolvedValueOnce({ state: 'invalid', failure: 'session_busy' });
    mockCaptureTeardown.mockResolvedValueOnce({ state: 'invalid', failure: 'teardown_failed' });
    await request(app())
      .post('/api/v1/admin/support-package/incident-capture')
      .send({ ...incidentSelectors, confirmIncidentCapture: true })
      .expect(503, { state: 'invalid', failure: 'session_busy' });
    await request(app())
      .delete('/api/v1/admin/support-package/incident-capture')
      .send({ confirmIncidentCaptureTeardown: true })
      .expect(503, { state: 'invalid', failure: 'teardown_failed' });
  });

  it('contains capture audit failures without exposing selectors', async () => {
    mockAudit.mockRejectedValue(new Error('audit failed'));
    await request(app())
      .post('/api/v1/admin/support-package/incident-capture')
      .send({ ...incidentSelectors, confirmIncidentCapture: true })
      .expect(201);
    await request(app())
      .delete('/api/v1/admin/support-package/incident-capture')
      .send({ confirmIncidentCaptureTeardown: true })
      .expect(200);
    expect(mockWarn).toHaveBeenCalledWith(
      'Incident capture audit write failed',
      { code: 'audit_unavailable' },
    );
    expect(mockWarn).toHaveBeenCalledWith(
      'Incident capture teardown audit write failed',
      { code: 'audit_unavailable' },
    );
  });
});
