import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  download: vi.fn(),
  downloadBlob: vi.fn(),
  fetchBlob: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../../src/api/client', () => ({
  default: {
    delete: mocks.delete,
    download: mocks.download,
    fetchBlob: mocks.fetchBlob,
    get: mocks.get,
    post: mocks.post,
  },
}));
vi.mock('../../../src/utils/download', () => ({
  downloadBlob: mocks.downloadBlob,
}));

import {
  armIncidentCapture,
  downloadSupportPackage,
  downloadSupportPackageArtifact,
  getIncidentCaptureStatus,
  previewIncidentSupportPackage,
  previewSupportPackage,
  teardownIncidentCapture,
  type IncidentProfileRequest,
} from '../../../src/api/admin/supportPackage';

const request: IncidentProfileRequest = {
  txid: 'a'.repeat(64),
  senderWalletId: 'sender-1',
  receiverWalletId: 'receiver-2',
  approximateIncidentTime: '2026-08-02T12:30:00.000Z',
};

function packageBlob(profile: 'shareable_aggregate' | 'single_incident' = 'shareable_aggregate') {
  return new Blob([JSON.stringify({
    version: profile === 'shareable_aggregate' ? '2.1.0' : '1.0.0',
    profile,
    generatedAt: '2026-08-02T12:30:00.000Z',
    collectors: {
      notificationQueue: {
        status: 'ok',
        truncated: false,
        droppedCount: 0,
        provenance: {
          sourceProcess: 'redis_shared',
          sourceKind: 'queue_getters',
          observationWindow: 'point_in_time',
        },
        data: { waitingCountBucket: 'one' },
      },
    },
    meta: { privacyValidation: 'passed' },
  })], { type: 'application/json' });
}

describe('support package API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves the compatibility aggregate download action', async () => {
    mocks.download.mockResolvedValue(undefined);

    await downloadSupportPackage();

    expect(mocks.download).toHaveBeenCalledWith('/admin/support-package', undefined, {
      method: 'POST',
      body: { confirmShareableAggregate: true },
    });
  });

  it('fetches and parses one aggregate Blob for preview', async () => {
    const blob = packageBlob();
    mocks.fetchBlob.mockResolvedValue(blob);

    const artifact = await previewSupportPackage();

    expect(mocks.fetchBlob).toHaveBeenCalledWith('/admin/support-package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmShareableAggregate: true }),
    });
    expect(artifact.blob).toBe(blob);
    expect(artifact.preview).toMatchObject({
      profile: 'shareable_aggregate',
      privacyValidation: 'passed',
    });
  });

  it('recognizes successful legacy aggregate bytes as server privacy-validated', async () => {
    const blob = new Blob([JSON.stringify({
      version: '2.0.0',
      profile: 'shareable_aggregate',
      generatedAt: '2026-08-02T12:30:00.000Z',
      collectors: {},
      meta: { succeeded: [], failed: [] },
    })]);
    mocks.fetchBlob.mockResolvedValue(blob);

    const artifact = await previewSupportPackage();

    expect(artifact.preview.privacyValidation).toBe('passed');
    expect(artifact.blob).toBe(blob);
  });

  it('uses a distinct confirmed incident endpoint and retains its original Blob', async () => {
    const blob = packageBlob('single_incident');
    mocks.fetchBlob.mockResolvedValue(blob);

    const artifact = await previewIncidentSupportPackage(request);

    expect(mocks.fetchBlob).toHaveBeenCalledWith('/admin/support-package/incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, confirmIncidentProfile: true }),
    });
    expect(artifact.blob).toBe(blob);
    expect(artifact.preview.profile).toBe('single_incident');
  });

  it('downloads the byte-identical preview Blob without another request', async () => {
    const blob = packageBlob();
    mocks.fetchBlob.mockResolvedValue(blob);
    const artifact = await previewSupportPackage();
    mocks.fetchBlob.mockClear();

    downloadSupportPackageArtifact(artifact);

    expect(mocks.downloadBlob).toHaveBeenCalledWith(blob, artifact.filename);
    expect(mocks.fetchBlob).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'invalid JSON', blob: new Blob(['not-json']) },
    {
      label: 'invalid envelope',
      blob: new Blob([JSON.stringify({ profile: 'shareable_aggregate' })]),
    },
  ])('rejects malformed package bytes ($label)', async ({ blob }) => {
    mocks.fetchBlob.mockResolvedValue(blob);
    await expect(previewSupportPackage()).rejects.toThrow();
  });

  it.each([
    [null, 'envelope'],
    [[], 'envelope'],
    [{ version: 2 }, 'envelope'],
    [{ version: '2.0.0', profile: 'private', generatedAt: 'now', collectors: {} }, 'profile'],
    [{ version: '2.0.0', profile: 'shareable_aggregate', generatedAt: 1, collectors: {} }, 'envelope'],
    [{ version: '2.0.0', profile: 'shareable_aggregate', generatedAt: 'now', collectors: [] }, 'envelope'],
    [{
      version: '2.0.0', profile: 'shareable_aggregate', generatedAt: 'now',
      collectors: { bad: null },
    }, 'section'],
    [{
      version: '2.0.0', profile: 'shareable_aggregate', generatedAt: 'now',
      collectors: { bad: { status: 'private', truncated: false, droppedCount: 0 } },
    }, 'section'],
    [{
      version: '2.0.0', profile: 'shareable_aggregate', generatedAt: 'now',
      collectors: { bad: { status: 'ok', truncated: 'no', droppedCount: 0 } },
    }, 'bounds'],
    [{
      version: '2.0.0', profile: 'shareable_aggregate', generatedAt: 'now',
      collectors: { bad: { status: 'ok', truncated: false, droppedCount: 'zero' } },
    }, 'bounds'],
    [{
      version: '2.0.0', profile: 'shareable_aggregate', generatedAt: 'now', collectors: {},
      privacyValidation: 'failed',
    }, 'privacy'],
  ])('rejects malformed parsed package variant %# (%s)', async (value, _label) => {
    mocks.fetchBlob.mockResolvedValue(new Blob([JSON.stringify(value)]));
    await expect(previewSupportPackage()).rejects.toThrow();
  });

  it('parses optional section shapes without trusting malformed provenance or data', async () => {
    const value = {
      version: '2.0.0',
      profile: 'shareable_aggregate',
      generatedAt: '2026-08-02T12:30:00.000Z',
      collectors: {
        minimal: { status: 'error', truncated: true, droppedCount: 1 },
        malformedOptional: {
          status: 'ok',
          truncated: false,
          droppedCount: 0,
          provenance: { sourceProcess: 1, sourceKind: false, observationWindow: null },
          data: [],
        },
      },
      privacyValidation: 'passed',
      meta: null,
    };
    mocks.fetchBlob.mockResolvedValue(new Blob([JSON.stringify(value)]));
    const artifact = await previewSupportPackage();
    expect(artifact.preview.collectors.minimal).not.toHaveProperty('provenance');
    expect(artifact.preview.collectors.malformedOptional).toEqual({
      status: 'ok', truncated: false, droppedCount: 0, provenance: {},
    });
  });

  it('uses isolated capture status, arm, and teardown actions', async () => {
    mocks.get.mockResolvedValue({ state: 'inactive' });
    mocks.post.mockResolvedValue({ state: 'ready', expiresIn: 'under_fifteen_minutes' });
    mocks.delete.mockResolvedValue({ state: 'inactive' });

    await expect(getIncidentCaptureStatus()).resolves.toEqual({ state: 'inactive' });
    await expect(armIncidentCapture(request)).resolves.toMatchObject({ state: 'ready' });
    await expect(teardownIncidentCapture()).resolves.toEqual({ state: 'inactive' });

    expect(mocks.get).toHaveBeenCalledWith('/admin/support-package/incident-capture');
    expect(mocks.post).toHaveBeenCalledWith('/admin/support-package/incident-capture', {
      ...request,
      confirmIncidentCapture: true,
    });
    expect(mocks.delete).toHaveBeenCalledWith('/admin/support-package/incident-capture', {
      confirmIncidentCaptureTeardown: true,
    });
  });
});
