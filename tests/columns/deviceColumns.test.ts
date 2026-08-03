/**
 * Device Column Utilities Tests
 *
 * Tests for column order merging and visibility functions.
 */

import { describe,expect,it } from 'vitest';
import {
DEFAULT_DEVICE_COLUMN_ORDER,
DEFAULT_DEVICE_VISIBLE_COLUMNS,
DEVICE_COLUMNS,
getDeviceColumnsInOrder,
mergeDeviceColumnOrder,
} from '../../src/components/columns/deviceColumns';

describe('deviceColumns', () => {
  describe('mergeDeviceColumnOrder', () => {
    it('returns defaults when savedOrder is undefined', () => {
      const result = mergeDeviceColumnOrder(undefined);
      expect(result).toEqual(DEFAULT_DEVICE_COLUMN_ORDER);
    });

    it('returns defaults when savedOrder is empty array', () => {
      const result = mergeDeviceColumnOrder([]);
      expect(result).toEqual(DEFAULT_DEVICE_COLUMN_ORDER);
    });

    it('preserves valid column order from saved preferences', () => {
      const savedOrder = ['wallets', 'label', 'type'];
      const result = mergeDeviceColumnOrder(savedOrder);
      expect(result.slice(0, 3)).toEqual(['wallets', 'label', 'type']);
    });

    it('filters out invalid/removed column IDs', () => {
      const savedOrder = ['label', 'invalid_column', 'wallets', 'removed_column'];
      const result = mergeDeviceColumnOrder(savedOrder);
      expect(result).not.toContain('invalid_column');
      expect(result).not.toContain('removed_column');
      expect(result).toContain('label');
      expect(result).toContain('wallets');
    });

    it('appends new columns not in saved order', () => {
      // Simulate saved order missing some columns (user saved before new columns added)
      const savedOrder = ['label', 'wallets'];
      const result = mergeDeviceColumnOrder(savedOrder);

      // Should have label and wallets first (preserved order)
      expect(result[0]).toBe('label');
      expect(result[1]).toBe('wallets');

      // Should include all default columns
      for (const col of DEFAULT_DEVICE_COLUMN_ORDER) {
        expect(result).toContain(col);
      }

      // Total length should match defaults
      expect(result.length).toBe(DEFAULT_DEVICE_COLUMN_ORDER.length);
    });

    it('handles duplicates in saved order', () => {
      const savedOrder = ['label', 'wallets', 'label', 'wallets'];
      const result = mergeDeviceColumnOrder(savedOrder);

      // Each column should appear only once
      const labelCounts = result.filter(id => id === 'label').length;
      const walletsCounts = result.filter(id => id === 'wallets').length;
      expect(labelCounts).toBe(1);
      expect(walletsCounts).toBe(1);
    });

    it('returns correct length matching default columns', () => {
      const savedOrder = ['type', 'label'];
      const result = mergeDeviceColumnOrder(savedOrder);
      expect(result.length).toBe(DEFAULT_DEVICE_COLUMN_ORDER.length);
    });
  });

  describe('getDeviceColumnsInOrder', () => {
    it('returns defaults when both params are undefined', () => {
      const result = getDeviceColumnsInOrder(undefined, undefined);
      expect(result).toEqual(DEFAULT_DEVICE_VISIBLE_COLUMNS);
    });

    it('returns defaults when both params are empty arrays', () => {
      const result = getDeviceColumnsInOrder([], []);
      expect(result).toEqual(DEFAULT_DEVICE_VISIBLE_COLUMNS);
    });

    it('respects visibility preferences', () => {
      const columnOrder = DEFAULT_DEVICE_COLUMN_ORDER;
      const visibleColumns = ['label', 'fingerprint']; // Only show label and fingerprint

      const result = getDeviceColumnsInOrder(columnOrder, visibleColumns);

      // Should include visible columns
      expect(result).toContain('label');
      expect(result).toContain('fingerprint');
      // Type, wallets, actions should not be included (unless required)
      expect(result).not.toContain('type');
      expect(result).not.toContain('wallets');
      expect(result).not.toContain('actions');
    });

    it('always includes required columns even if not in visible set', () => {
      const columnOrder = DEFAULT_DEVICE_COLUMN_ORDER;
      const visibleColumns = ['type', 'wallets']; // Missing required column (label)

      const result = getDeviceColumnsInOrder(columnOrder, visibleColumns);

      // Required columns should still be included
      const requiredColumns = Object.entries(DEVICE_COLUMNS)
        .filter(([, config]) => config.required)
        .map(([id]) => id);

      for (const reqCol of requiredColumns) {
        expect(result).toContain(reqCol);
      }
    });

    it('respects custom column order', () => {
      const columnOrder = ['actions', 'label', 'type'];
      const visibleColumns = ['actions', 'label', 'type'];

      const result = getDeviceColumnsInOrder(columnOrder, visibleColumns);

      expect(result[0]).toBe('actions');
      expect(result[1]).toBe('label');
      expect(result[2]).toBe('type');
    });

    it('filters out invalid column IDs from order', () => {
      const columnOrder = ['label', 'invalid_col', 'wallets'];
      const visibleColumns = ['label', 'invalid_col', 'wallets'];

      const result = getDeviceColumnsInOrder(columnOrder, visibleColumns);

      expect(result).not.toContain('invalid_col');
      expect(result).toContain('label');
      expect(result).toContain('wallets');
    });

    it('filters out invalid column IDs from visible set', () => {
      const columnOrder = DEFAULT_DEVICE_COLUMN_ORDER;
      const visibleColumns = ['label', 'fake_column', 'wallets'];

      const result = getDeviceColumnsInOrder(columnOrder, visibleColumns);

      expect(result).not.toContain('fake_column');
    });

    it('appends required columns at end if missing from order', () => {
      // Custom order missing required column (label)
      const columnOrder = ['type', 'wallets'];
      const visibleColumns = ['type', 'wallets'];

      const result = getDeviceColumnsInOrder(columnOrder, visibleColumns);

      // Required columns should be appended
      const requiredColumns = Object.entries(DEVICE_COLUMNS)
        .filter(([, config]) => config.required)
        .map(([id]) => id);

      for (const reqCol of requiredColumns) {
        expect(result).toContain(reqCol);
      }

      // Type and wallets should come first (from order)
      expect(result.indexOf('type')).toBeLessThan(result.indexOf('label'));
    });
  });

  describe('DEVICE_COLUMNS configuration', () => {
    it('has required columns defined', () => {
      const requiredColumns = Object.entries(DEVICE_COLUMNS)
        .filter(([, config]) => config.required)
        .map(([id]) => id);

      expect(requiredColumns.length).toBeGreaterThan(0);
      expect(requiredColumns).toContain('label');
    });

    it('all columns have valid configuration', () => {
      for (const [id, config] of Object.entries(DEVICE_COLUMNS)) {
        expect(config.id).toBe(id);
        expect(typeof config.label).toBe('string');
        expect(config.label.length).toBeGreaterThan(0);
        expect(typeof config.sortable).toBe('boolean');
        expect(['left', 'center', 'right', undefined]).toContain(config.align);
      }
    });

    it('sortable columns have sortKey defined', () => {
      for (const [, config] of Object.entries(DEVICE_COLUMNS)) {
        if (config.sortable) {
          expect(config.sortKey).toBeDefined();
          expect(typeof config.sortKey).toBe('string');
        }
      }
    });

    it('actions column is not sortable', () => {
      expect(DEVICE_COLUMNS.actions.sortable).toBe(false);
    });

    it('accounts column is not sortable', () => {
      expect(DEVICE_COLUMNS.accounts.sortable).toBe(false);
    });

    it('has accounts column for derivation paths', () => {
      expect(DEVICE_COLUMNS.accounts).toBeDefined();
      expect(DEVICE_COLUMNS.accounts.label).toBe('Accounts');
      expect(DEVICE_COLUMNS.accounts.defaultVisible).toBe(true);
    });
  });
});
