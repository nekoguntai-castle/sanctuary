import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncPausedBanner } from '../../../src/components/Layout/SyncPausedBanner';
import * as syncApi from '../../../src/api/sync';

vi.mock('../../../src/api/sync', () => ({
  getSyncAvailability: vi.fn(),
}));

const getSyncAvailability = vi.mocked(syncApi.getSyncAvailability);
const NOW = '2026-11-04T23:30:00.000Z';

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

describe('SyncPausedBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    setHidden(false);
  });

  it('renders nothing while wallet sync is available', async () => {
    getSyncAvailability.mockResolvedValue({ state: 'available' });

    const { container } = render(<SyncPausedBanner />);
    await flush();

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the cause and the estimated resume time', async () => {
    const resumesAt = '2026-11-05T00:14:00.000Z';
    getSyncAvailability.mockResolvedValue({ state: 'paused', reason: 'restart_recovery', resumesAt });

    render(<SyncPausedBanner />);
    await flush();

    const time = new Date(resumesAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(screen.getByRole('status')).toHaveTextContent(
      `Wallet sync is paused while the background worker recovers from a restart. New transactions will appear after about ${time}.`,
    );
  });

  it.each([
    ['no estimate', null],
    ['an unparseable estimate', 'not-a-date'],
    ['an estimate that has already passed', '2026-11-04T23:29:00.000Z'],
  ])('uses an open-ended outlook given %s', async (_label, resumesAt) => {
    getSyncAvailability.mockResolvedValue({ state: 'paused', reason: 'stabilizing', resumesAt });

    render(<SyncPausedBanner />);
    await flush();

    expect(screen.getByRole('status')).toHaveTextContent(
      'Wallet sync is paused while the background worker confirms it is ready. New transactions will appear once it resumes.',
    );
  });

  it.each([
    ['worker_unavailable', 'Wallet sync is paused because the background worker is unreachable.'],
    ['gated', 'Wallet sync is paused until the background worker is ready.'],
  ] as const)('names the %s cause', async (reason, cause) => {
    getSyncAvailability.mockResolvedValue({ state: 'paused', reason, resumesAt: null });

    render(<SyncPausedBanner />);
    await flush();

    expect(screen.getByRole('status')).toHaveTextContent(cause);
  });

  it('keeps the last known state when a poll fails', async () => {
    getSyncAvailability.mockRejectedValue(new Error('offline'));

    const { container } = render(<SyncPausedBanner />);
    await flush();

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps an unchanged pause and clears it once a later poll reports sync available', async () => {
    const pause = { state: 'paused', reason: 'gated', resumesAt: null } as const;
    getSyncAvailability
      .mockResolvedValueOnce(pause)
      .mockResolvedValueOnce({ ...pause })
      .mockResolvedValue({ state: 'available' });

    render(<SyncPausedBanner />);
    await flush();
    const banner = screen.getByRole('status');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole('status')).toBe(banner);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(getSyncAvailability).toHaveBeenCalledTimes(3);
  });

  it('skips polls while the tab is hidden and refreshes when it becomes visible', async () => {
    setHidden(true);
    getSyncAvailability.mockResolvedValue({ state: 'paused', reason: 'gated', resumesAt: null });

    render(<SyncPausedBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getSyncAvailability).not.toHaveBeenCalled();

    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(getSyncAvailability).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('ignores a response that arrives after unmount and stops polling', async () => {
    let resolve!: (value: { state: 'available' }) => void;
    getSyncAvailability.mockReturnValue(new Promise(r => { resolve = r; }));

    const { unmount } = render(<SyncPausedBanner />);
    unmount();
    resolve({ state: 'available' });
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(getSyncAvailability).toHaveBeenCalledTimes(1);
  });
});
