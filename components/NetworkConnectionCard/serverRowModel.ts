import type { ElectrumServer } from '../../types';
import type { ServerStats } from '../../src/api/bitcoin';

export function getServerRowClass(enabled: boolean): string {
  return enabled
    ? 'surface-muted border-sanctuary-200 dark:border-sanctuary-700'
    : 'surface-secondary border-sanctuary-100 dark:border-sanctuary-800 opacity-60';
}

export function getHealthIndicatorClass(
  serverTestStatus: 'idle' | 'testing' | 'success' | 'error',
  isHealthy: ElectrumServer['isHealthy']
): string {
  if (serverTestStatus === 'success') return 'bg-emerald-500';
  if (serverTestStatus === 'error') return 'bg-rose-500';
  if (isHealthy) return 'bg-emerald-500';
  if (isHealthy === false) return 'bg-rose-500';
  return 'bg-sanctuary-400';
}

export function getProtocolBadgeClass(useSsl: boolean): string {
  return useSsl
    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
    : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500';
}

export function getFallbackHealthTitle(lastHealthCheck: string | null | undefined): string {
  return lastHealthCheck
    ? `Last check: ${new Date(lastHealthCheck).toLocaleTimeString()}`
    : 'No health checks yet';
}

export function getFallbackHealthBlockClass(
  hasHealthData: boolean,
  isFailedBlock: boolean
): string {
  if (!hasHealthData) return 'bg-sanctuary-300 dark:bg-sanctuary-600';
  if (isFailedBlock) return 'bg-rose-400 dark:bg-rose-500';
  return 'bg-emerald-400 dark:bg-emerald-500';
}

export function isServerCoolingDown(serverPoolStats: ServerStats | undefined): boolean {
  return Boolean(
    serverPoolStats?.cooldownUntil
      && new Date(serverPoolStats.cooldownUntil) > new Date()
  );
}
