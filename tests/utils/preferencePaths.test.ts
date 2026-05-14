import { describe, expect, it } from 'vitest';
import {
  applyPreferenceRollback,
  buildPreferencePathPatch,
  capturePreferenceRollback,
  getPreferencePathValue,
  getPreferencePatchKeys,
  mergePreferencePatch,
} from '../../utils/preferencePaths';

describe('preference path utilities', () => {
  it('reads nested preference values by dot path', () => {
    expect(getPreferencePathValue({
      viewSettings: {
        wallets: {
          layout: 'grid',
        },
      },
    }, 'viewSettings.wallets.layout')).toBe('grid');
  });

  it('returns undefined when a nested ancestor is missing or non-object', () => {
    expect(getPreferencePathValue({ viewSettings: null }, 'viewSettings.wallets.layout')).toBeUndefined();
    expect(getPreferencePathValue({ viewSettings: { wallets: ['bad'] } }, 'viewSettings.wallets.layout')).toBeUndefined();
  });

  it('builds nested patches while preserving object siblings', () => {
    expect(buildPreferencePathPatch('viewSettings.wallets.layout', 'list', {
      viewSettings: {
        wallets: {
          layout: 'grid',
          sortBy: 'name',
        },
        devices: {
          layout: 'table',
        },
      },
    })).toEqual({
      viewSettings: {
        wallets: {
          layout: 'list',
          sortBy: 'name',
        },
        devices: {
          layout: 'table',
        },
      },
    });
  });

  it('replaces non-object ancestors with new objects for deeper paths', () => {
    expect(buildPreferencePathPatch('viewSettings.wallets.layout', 'grid', {
      viewSettings: {
        wallets: ['legacy'],
      },
    })).toEqual({
      viewSettings: {
        wallets: {
          layout: 'grid',
        },
      },
    });
  });

  it('keeps arrays as replacement values at the target path', () => {
    expect(buildPreferencePathPatch('viewSettings.wallets.columnOrder', ['name', 'status'], {
      viewSettings: {
        wallets: {
          columnOrder: ['status'],
          layout: 'table',
        },
      },
    })).toEqual({
      viewSettings: {
        wallets: {
          columnOrder: ['name', 'status'],
          layout: 'table',
        },
      },
    });
  });

  it.each(['', '.theme', 'theme.', 'viewSettings..wallets', '__proto__', 'theme.constructor'])(
    'rejects invalid preference path %s',
    path => {
      expect(() => buildPreferencePathPatch(path, true, {})).toThrow();
    },
  );

  it('rejects unsafe top-level patch keys', () => {
    const patch = Object.create(null) as Record<string, unknown>;
    patch['constructor'] = 'bad';

    expect(() => getPreferencePatchKeys(patch)).toThrow(/unsafe/);
  });

  it('merges top-level patches without deep-merging nested objects', () => {
    expect(mergePreferencePatch({
      darkMode: true,
      viewSettings: { wallets: { layout: 'grid' } },
    }, {
      viewSettings: { devices: { layout: 'list' } },
    })).toEqual({
      darkMode: true,
      viewSettings: { devices: { layout: 'list' } },
    });
  });

  it('rolls back only keys approved by the generation guard', () => {
    const snapshot = capturePreferenceRollback({ darkMode: true }, ['darkMode', 'fiatCurrency']);

    expect(applyPreferenceRollback(
      { darkMode: false, fiatCurrency: 'EUR', theme: 'forest' },
      snapshot,
      key => key === 'darkMode',
    )).toEqual({
      darkMode: true,
      fiatCurrency: 'EUR',
      theme: 'forest',
    });
  });

  it('deletes keys that did not exist before a failed optimistic write', () => {
    const snapshot = capturePreferenceRollback({ darkMode: true }, ['fiatCurrency']);

    expect(applyPreferenceRollback(
      { darkMode: true, fiatCurrency: 'EUR' },
      snapshot,
      key => key === 'fiatCurrency',
    )).toEqual({
      darkMode: true,
    });
  });
});
