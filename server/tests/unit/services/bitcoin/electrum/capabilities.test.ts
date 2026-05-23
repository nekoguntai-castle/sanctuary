import { describe, expect, it } from 'vitest';
import {
  getCapabilityStatus,
  isCapabilityCheckFresh,
  isElectrumFeature,
  normalizeElectrumCapabilityProfile,
  normalizeRequiredFeatures,
  normalizeServerUsage,
  parseSilentPaymentVersionsValue,
  resolveFeaturePoolUsage,
  serverUsageMatchesPool,
  serverSatisfiesRequiredFeatures,
} from '../../../../../src/services/bitcoin/electrum/capabilities';

describe('Electrum capability normalization', () => {
  it('detects Frigate-compatible Silent Payments v0 support from server.features', () => {
    const profile = normalizeElectrumCapabilityProfile({
      serverFeatures: { silent_payments: [0, 0] },
      serverVersion: 'Frigate',
      protocolVersion: '1.6',
      supportsVerbose: true,
    });

    expect(profile).toMatchObject({
      serverFeatures: { silent_payments: [0, 0] },
      serverVersion: 'Frigate',
      protocolVersion: '1.6',
      supportsVerbose: true,
      silentPaymentVersions: [0],
      supportsSilentPaymentsV0: true,
      lastCapabilityError: null,
    });
  });

  it('fails closed for malformed silent_payments advertisements', () => {
    const profile = normalizeElectrumCapabilityProfile({
      serverFeatures: { silent_payments: ['0'] },
      serverVersion: 'custom',
      protocolVersion: '1.6',
    });

    expect(profile.supportsSilentPaymentsV0).toBe(false);
    expect(profile.silentPaymentVersions).toEqual([]);
    expect(profile.lastCapabilityError).toContain('non-negative integers');
  });

  it('treats missing Silent Payments advertisements as unsupported without parse errors', () => {
    const noAdvertisement = normalizeElectrumCapabilityProfile({
      serverFeatures: { hosts: {} },
    });
    const nullAdvertisement = normalizeElectrumCapabilityProfile({
      serverFeatures: { silent_payments: null },
    });

    expect(noAdvertisement.silentPaymentVersions).toEqual([]);
    expect(noAdvertisement.supportsSilentPaymentsV0).toBe(false);
    expect(noAdvertisement.lastCapabilityError).toBeNull();
    expect(nullAdvertisement.lastCapabilityError).toBeNull();
  });

  it('records invalid feature objects and non-array advertisements as capability errors', () => {
    const invalidFeatures = normalizeElectrumCapabilityProfile({
      serverFeatures: ['not-a-feature-object'],
    });
    const nonArrayAdvertisement = normalizeElectrumCapabilityProfile({
      serverFeatures: { silent_payments: 0 },
    });

    expect(invalidFeatures.serverFeatures).toBeNull();
    expect(invalidFeatures.lastCapabilityError).toBe(
      'server.features returned an invalid feature object',
    );
    expect(nonArrayAdvertisement.silentPaymentVersions).toEqual([]);
    expect(nonArrayAdvertisement.lastCapabilityError).toContain(
      'must be an array',
    );
  });

  it('normalizes capability helper inputs for pool partitioning', () => {
    expect(parseSilentPaymentVersionsValue([1, 0, 1])).toEqual([0, 1]);
    expect(isElectrumFeature('silent_payments_v0')).toBe(true);
    expect(isElectrumFeature('compact_filters')).toBe(false);
    expect(normalizeRequiredFeatures([
      'silent_payments_v0',
      'base_electrum',
      'silent_payments_v0',
    ])).toEqual(['base_electrum', 'silent_payments_v0']);
    expect(normalizeRequiredFeatures(undefined)).toEqual([]);
    expect(normalizeServerUsage('both')).toBe('both');
    expect(normalizeServerUsage('mixed')).toBe('general');
    expect(resolveFeaturePoolUsage(['silent_payments_v0'])).toBe(
      'silent_payments',
    );
    expect(resolveFeaturePoolUsage(['base_electrum'], 'both')).toBe('both');
    expect(serverUsageMatchesPool('both', 'silent_payments')).toBe(true);
    expect(serverUsageMatchesPool('silent_payments', 'both')).toBe(false);
  });

  it('handles freshness boundaries and base-only capability checks', () => {
    const checkedAt = new Date('2026-05-23T12:00:00.000Z');

    expect(isCapabilityCheckFresh(checkedAt, {
      now: checkedAt.getTime(),
      capabilityStaleAfterMs: 0,
    })).toBe(true);
    expect(isCapabilityCheckFresh('not-a-date')).toBe(false);
    expect(getCapabilityStatus({}, ['base_electrum'])).toBe('supported');
    expect(serverSatisfiesRequiredFeatures(
      {},
      ['base_electrum'],
    )).toBe(true);
    expect(serverSatisfiesRequiredFeatures(
      { lastCapabilityError: 'probe failed' },
      ['verbose_tx'],
    )).toBe(false);
    expect(serverSatisfiesRequiredFeatures(
      {
        supportsVerbose: true,
        lastCapabilityCheck: checkedAt,
        lastCapabilityError: null,
      },
      ['verbose_tx'],
      { now: checkedAt.getTime() },
    )).toBe(true);
  });

  it('excludes unknown, stale, errored, and unsupported capability profiles from feature pools', () => {
    const fresh = new Date('2026-05-23T12:00:00.000Z');
    const now = fresh.getTime() + 1_000;

    expect(serverSatisfiesRequiredFeatures(
      {
        supportsSilentPaymentsV0: true,
        lastCapabilityCheck: fresh,
        lastCapabilityError: null,
      },
      ['silent_payments_v0'],
      { now },
    )).toBe(true);

    expect(getCapabilityStatus({
      supportsSilentPaymentsV0: true,
      lastCapabilityCheck: new Date('2026-05-21T12:00:00.000Z'),
    }, ['silent_payments_v0'], { now })).toBe('stale');

    expect(getCapabilityStatus({
      supportsSilentPaymentsV0: null,
      lastCapabilityCheck: null,
    }, ['silent_payments_v0'], { now })).toBe('unknown');

    expect(getCapabilityStatus({
      supportsSilentPaymentsV0: false,
      lastCapabilityCheck: fresh,
    }, ['silent_payments_v0'], { now })).toBe('unsupported');

    expect(getCapabilityStatus({
      supportsSilentPaymentsV0: true,
      lastCapabilityCheck: fresh,
      lastCapabilityError: 'server.features parse failed',
    }, ['silent_payments_v0'], { now })).toBe('error');
  });
});
