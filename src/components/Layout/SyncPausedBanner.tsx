import React, { useEffect, useState } from 'react';
import { CirclePause } from 'lucide-react';
import type { WalletSyncAvailability, WalletSyncPauseReason } from '@sanctuary/shared/types/api';
import * as syncApi from '../../api/sync';
import { createLogger } from '../../utils/logger';
import { LayoutNotice } from './LayoutNotice';

const log = createLogger('SyncPausedBanner');

const POLL_INTERVAL_MS = 60_000;

type PausedAvailability = Extract<WalletSyncAvailability, { state: 'paused' }>;

const PAUSE_CAUSE: Record<WalletSyncPauseReason, string> = {
  restart_recovery: 'Wallet sync is paused while the background worker recovers from a restart.',
  stabilizing: 'Wallet sync is paused while the background worker confirms it is ready.',
  worker_unavailable: 'Wallet sync is paused because the background worker is unreachable.',
  gated: 'Wallet sync is paused until the background worker is ready.',
};

/** Clock time of a future resume estimate; null once it has passed or is unknown. */
function formatResumeTime(resumesAt: string | null): string | null {
  if (!resumesAt) return null;
  const resumeMs = Date.parse(resumesAt);
  if (!Number.isFinite(resumeMs) || resumeMs <= Date.now()) return null;
  return new Date(resumeMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function pauseMessage({ reason, resumesAt }: PausedAvailability): string {
  const resumeTime = formatResumeTime(resumesAt);
  const outlook = resumeTime
    ? `New transactions will appear after about ${resumeTime}.`
    : 'New transactions will appear once it resumes.';
  return `${PAUSE_CAUSE[reason]} ${outlook}`;
}

function samePause(a: PausedAvailability | null, b: PausedAvailability | null): boolean {
  return a?.reason === b?.reason && a?.resumesAt === b?.resumesAt;
}

/**
 * App-wide notice for a fleet-wide wallet sync hold, such as the activation
 * drain after a worker restart. Without it, a paused sync looks like a failure.
 * A failed poll keeps the last known state rather than guessing.
 */
export const SyncPausedBanner: React.FC = () => {
  const [pause, setPause] = useState<PausedAvailability | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      if (document.hidden) return;
      try {
        const availability = await syncApi.getSyncAvailability();
        if (!active) return;
        const next = availability.state === 'paused' ? availability : null;
        setPause(previous => (samePause(previous, next) ? previous : next));
      } catch (error) {
        log.debug('Failed to fetch wallet sync availability', { error });
      }
    };

    void refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  if (!pause) return null;

  return (
    <LayoutNotice icon={CirclePause} role="status">
      {pauseMessage(pause)}
    </LayoutNotice>
  );
};
