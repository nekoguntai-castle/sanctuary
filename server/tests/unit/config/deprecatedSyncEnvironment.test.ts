import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEPRECATED_STALE_SYNC_ENVIRONMENT_VARIABLES,
  warnDeprecatedStaleSyncEnvironment,
} from '../../../src/config/deprecatedSyncEnvironment';

describe('deprecated stale-sync environment', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('stays quiet when no retired compatibility variable is configured', () => {
    for (const name of DEPRECATED_STALE_SYNC_ENVIRONMENT_VARIABLES) {
      vi.stubEnv(name, '');
    }
    const warn = vi.fn();

    warnDeprecatedStaleSyncEnvironment(warn);

    expect(warn).not.toHaveBeenCalled();
  });

  it.each(DEPRECATED_STALE_SYNC_ENVIRONMENT_VARIABLES)(
    'warns once without logging the value when %s is present',
    (name) => {
      for (const candidate of DEPRECATED_STALE_SYNC_ENVIRONMENT_VARIABLES) {
        vi.stubEnv(candidate, '');
      }
      vi.stubEnv(name, 'private-value');
      const warn = vi.fn();

      warnDeprecatedStaleSyncEnvironment(warn);

      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        'Deprecated stale-wallet scheduler configuration is ignored after retirement',
        { variable: name },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-value');
    },
  );
});
