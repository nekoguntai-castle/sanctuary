import { describe, expect, it } from 'vitest';
import {
  normalizeNotificationFailureClass,
  normalizeNotificationOutcome,
  summarizeSafeNotificationOutcome,
  toSafeChannelOutcome,
} from '../../../../src/services/notifications/outcomes';

describe('notification outcomes', () => {
  it('maps legacy fulfilled failures to ambiguous instead of accepted', () => {
    expect(toSafeChannelOutcome({
      success: false,
      channelId: 'telegram',
      usersNotified: 0,
    })).toEqual({
      channel: 'telegram',
      outcome: 'ambiguous',
      failureClass: 'unknown',
    });
  });

  it('classifies mixed channel acceptance and rejection as partial', () => {
    expect(summarizeSafeNotificationOutcome([
      {
        success: true,
        channelId: 'push',
        usersNotified: 1,
        outcome: 'accepted',
        failureClass: 'none',
      },
      {
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        outcome: 'rejected',
        failureClass: 'authentication',
      },
    ])).toEqual({
      outcome: 'partial',
      failureClass: 'authentication',
      channels: [
        { channel: 'push', outcome: 'accepted', failureClass: 'none' },
        { channel: 'telegram', outcome: 'rejected', failureClass: 'authentication' },
      ],
    });
  });

  it('maps unregistered and unknown channels into closed categories', () => {
    expect(summarizeSafeNotificationOutcome([])).toEqual({
      outcome: 'not_registered',
      failureClass: 'none',
      channels: [],
    });
    expect(toSafeChannelOutcome({
      success: true,
      channelId: 'custom-channel',
      usersNotified: 0,
    }).channel).toBe('other');

    expect(toSafeChannelOutcome({
      success: false,
      channelId: 'poison-channel',
      usersNotified: 0,
      outcome: 'wallet-secret' as never,
      failureClass: 'https://user:password@private-host' as never,
    })).toEqual({
      channel: 'other',
      outcome: 'ambiguous',
      failureClass: 'other',
    });
  });

  it('normalizes only allowlisted outcomes and failure classes', () => {
    expect(normalizeNotificationOutcome('rejected', 'ambiguous')).toBe('rejected');
    expect(normalizeNotificationOutcome({ private: 'payload' }, 'ambiguous')).toBe('ambiguous');
    expect(normalizeNotificationFailureClass('timeout', 'unknown')).toBe('timeout');
    expect(normalizeNotificationFailureClass('provider secret', 'unknown')).toBe('unknown');
  });

  it('aggregates each terminal outcome without inventing acceptance', () => {
    const result = (outcome: 'partial' | 'rejected' | 'not_registered' | 'no_recipients') => ({
      success: outcome === 'no_recipients',
      channelId: 'telegram',
      usersNotified: 0,
      outcome,
      failureClass: outcome === 'rejected' ? 'authentication' as const : 'none' as const,
    });

    expect(summarizeSafeNotificationOutcome([result('partial')]).outcome).toBe('partial');
    expect(summarizeSafeNotificationOutcome([result('rejected')]).outcome).toBe('rejected');
    expect(summarizeSafeNotificationOutcome([result('not_registered')]).outcome)
      .toBe('not_registered');
    expect(summarizeSafeNotificationOutcome([result('no_recipients')]).outcome)
      .toBe('no_recipients');
  });

  it('collapses differing failure classes to other', () => {
    expect(summarizeSafeNotificationOutcome([
      {
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        outcome: 'rejected',
        failureClass: 'authentication',
      },
      {
        success: false,
        channelId: 'push',
        usersNotified: 0,
        outcome: 'rejected',
        failureClass: 'timeout',
      },
    ]).failureClass).toBe('other');
  });
});
