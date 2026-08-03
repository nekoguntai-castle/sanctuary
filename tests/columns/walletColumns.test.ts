/**
 * Wallet Column Utilities Tests
 *
 * Tests for column order merging and visibility functions.
 */

import { describe,expect,it } from 'vitest';
import {
DEFAULT_WALLET_COLUMN_ORDER,
DEFAULT_WALLET_VISIBLE_COLUMNS,
getWalletColumnsInOrder,
mergeWalletColumnOrder,
WALLET_COLUMNS,
} from '../../src/components/columns/walletColumns';

describe('walletColumns', () => {
  describe('mergeWalletColumnOrder', () => {
    it('returns defaults when savedOrder is undefined', () => {
      const result = mergeWalletColumnOrder(undefined);
      expect(result).toEqual(DEFAULT_WALLET_COLUMN_ORDER);
    });

    it('returns defaults when savedOrder is empty array', () => {
      const result = mergeWalletColumnOrder([]);
      expect(result).toEqual(DEFAULT_WALLET_COLUMN_ORDER);
    });

    it('preserves valid column order from saved preferences', () => {
      const savedOrder = ['balance', 'name', 'type'];
      const result = mergeWalletColumnOrder(savedOrder);
      expect(result.slice(0, 3)).toEqual(['balance', 'name', 'type']);
    });

    it('filters out invalid/removed column IDs', () => {
      const savedOrder = ['name', 'invalid_column', 'balance', 'removed_column'];
      const result = mergeWalletColumnOrder(savedOrder);
      expect(result).not.toContain('invalid_column');
      expect(result).not.toContain('removed_column');
      expect(result).toContain('name');
      expect(result).toContain('balance');
    });

    it('appends new columns not in saved order', () => {
      // Simulate saved order missing some columns (user saved before new columns added)
      const savedOrder = ['name', 'balance'];
      const result = mergeWalletColumnOrder(savedOrder);

      // Should have name and balance first (preserved order)
      expect(result[0]).toBe('name');
      expect(result[1]).toBe('balance');

      // Should include all default columns
      for (const col of DEFAULT_WALLET_COLUMN_ORDER) {
        expect(result).toContain(col);
      }

      // New columns appended after saved order
      expect(result.length).toBe(DEFAULT_WALLET_COLUMN_ORDER.length);
    });

    it('handles duplicates in saved order', () => {
      const savedOrder = ['name', 'balance', 'name', 'balance'];
      const result = mergeWalletColumnOrder(savedOrder);

      // Each column should appear only once
      const nameCounts = result.filter(id => id === 'name').length;
      const balanceCounts = result.filter(id => id === 'balance').length;
      expect(nameCounts).toBe(1);
      expect(balanceCounts).toBe(1);
    });

    it('returns correct length matching default columns', () => {
      const savedOrder = ['type', 'name'];
      const result = mergeWalletColumnOrder(savedOrder);
      expect(result.length).toBe(DEFAULT_WALLET_COLUMN_ORDER.length);
    });
  });

  describe('getWalletColumnsInOrder', () => {
    it('returns defaults when both params are undefined', () => {
      const result = getWalletColumnsInOrder(undefined, undefined);
      expect(result).toEqual(DEFAULT_WALLET_VISIBLE_COLUMNS);
    });

    it('returns defaults when both params are empty arrays', () => {
      const result = getWalletColumnsInOrder([], []);
      expect(result).toEqual(DEFAULT_WALLET_VISIBLE_COLUMNS);
    });

    it('respects visibility preferences', () => {
      const columnOrder = DEFAULT_WALLET_COLUMN_ORDER;
      const visibleColumns = ['name', 'balance']; // Only show name and balance

      const result = getWalletColumnsInOrder(columnOrder, visibleColumns);

      // Should only include visible columns (plus required)
      expect(result).toContain('name');
      expect(result).toContain('balance');
      // Type, devices, sync, pending should not be included (unless required)
      expect(result).not.toContain('type');
      expect(result).not.toContain('devices');
      expect(result).not.toContain('sync');
      expect(result).not.toContain('pending');
    });

    it('always includes required columns even if not in visible set', () => {
      const columnOrder = DEFAULT_WALLET_COLUMN_ORDER;
      const visibleColumns = ['type', 'devices']; // Missing required columns

      const result = getWalletColumnsInOrder(columnOrder, visibleColumns);

      // Required columns (name, balance) should still be included
      const requiredColumns = Object.entries(WALLET_COLUMNS)
        .filter(([, config]) => config.required)
        .map(([id]) => id);

      for (const reqCol of requiredColumns) {
        expect(result).toContain(reqCol);
      }
    });

    it('respects custom column order', () => {
      const columnOrder = ['balance', 'name', 'type'];
      const visibleColumns = ['balance', 'name', 'type'];

      const result = getWalletColumnsInOrder(columnOrder, visibleColumns);

      expect(result[0]).toBe('balance');
      expect(result[1]).toBe('name');
      expect(result[2]).toBe('type');
    });

    it('filters out invalid column IDs from order', () => {
      const columnOrder = ['name', 'invalid_col', 'balance'];
      const visibleColumns = ['name', 'invalid_col', 'balance'];

      const result = getWalletColumnsInOrder(columnOrder, visibleColumns);

      expect(result).not.toContain('invalid_col');
      expect(result).toContain('name');
      expect(result).toContain('balance');
    });

    it('filters out invalid column IDs from visible set', () => {
      const columnOrder = DEFAULT_WALLET_COLUMN_ORDER;
      const visibleColumns = ['name', 'fake_column', 'balance'];

      const result = getWalletColumnsInOrder(columnOrder, visibleColumns);

      expect(result).not.toContain('fake_column');
    });

    it('appends required columns at end if missing from order', () => {
      // Custom order missing required columns
      const columnOrder = ['type', 'devices'];
      const visibleColumns = ['type', 'devices'];

      const result = getWalletColumnsInOrder(columnOrder, visibleColumns);

      // Required columns should be appended
      const requiredColumns = Object.entries(WALLET_COLUMNS)
        .filter(([, config]) => config.required)
        .map(([id]) => id);

      for (const reqCol of requiredColumns) {
        expect(result).toContain(reqCol);
      }

      // Type and devices should come first (from order)
      expect(result.indexOf('type')).toBeLessThan(result.indexOf('name'));
      expect(result.indexOf('devices')).toBeLessThan(result.indexOf('balance'));
    });
  });

  describe('WALLET_COLUMNS configuration', () => {
    it('has required columns defined', () => {
      const requiredColumns = Object.entries(WALLET_COLUMNS)
        .filter(([, config]) => config.required)
        .map(([id]) => id);

      expect(requiredColumns.length).toBeGreaterThan(0);
      expect(requiredColumns).toContain('name');
      expect(requiredColumns).toContain('balance');
    });

    it('all columns have valid configuration', () => {
      for (const [id, config] of Object.entries(WALLET_COLUMNS)) {
        expect(config.id).toBe(id);
        expect(typeof config.label).toBe('string');
        expect(config.label.length).toBeGreaterThan(0);
        expect(typeof config.sortable).toBe('boolean');
        expect(['left', 'center', 'right', undefined]).toContain(config.align);
      }
    });

    it('sortable columns have sortKey defined', () => {
      for (const [, config] of Object.entries(WALLET_COLUMNS)) {
        if (config.sortable) {
          expect(config.sortKey).toBeDefined();
          expect(typeof config.sortKey).toBe('string');
        }
      }
    });
  });
});
