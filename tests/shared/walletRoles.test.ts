import { describe, expect, it } from 'vitest';
import {
  WALLET_APPROVE_ROLE_VALUES,
  WALLET_EDIT_ROLE_VALUES,
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
  canWalletRoleApprove,
  canWalletRoleEdit,
  canWalletRoleOwn,
  canWalletRoleView,
  parseWalletRole,
  parseWalletShareRole,
} from '@sanctuary/shared/constants/walletRoles';

describe('wallet role constants', () => {
  it('defines persisted and shareable wallet roles', () => {
    expect(WALLET_ROLE_VALUES).toEqual(['owner', 'approver', 'signer', 'viewer']);
    expect(WALLET_SHARE_ROLE_VALUES).toEqual(['viewer', 'signer', 'approver']);
    expect(WALLET_EDIT_ROLE_VALUES).toEqual(['owner', 'signer']);
    expect(WALLET_APPROVE_ROLE_VALUES).toEqual(['owner', 'approver']);
  });

  it('parses unknown roles as no role', () => {
    expect(parseWalletRole('owner')).toBe('owner');
    expect(parseWalletRole('approver')).toBe('approver');
    expect(parseWalletRole('')).toBeNull();
    expect(parseWalletRole('admin')).toBeNull();
    expect(parseWalletRole(null)).toBeNull();
  });

  it('parses share roles without allowing owner assignment', () => {
    expect(parseWalletShareRole('viewer')).toBe('viewer');
    expect(parseWalletShareRole('signer')).toBe('signer');
    expect(parseWalletShareRole('approver')).toBe('approver');
    expect(parseWalletShareRole('owner')).toBeNull();
  });

  it('derives role capabilities', () => {
    expect(canWalletRoleView('viewer')).toBe(true);
    expect(canWalletRoleView(null)).toBe(false);
    expect(canWalletRoleEdit('owner')).toBe(true);
    expect(canWalletRoleEdit('signer')).toBe(true);
    expect(canWalletRoleEdit('approver')).toBe(false);
    expect(canWalletRoleApprove('approver')).toBe(true);
    expect(canWalletRoleApprove('signer')).toBe(false);
    expect(canWalletRoleOwn('owner')).toBe(true);
    expect(canWalletRoleOwn('approver')).toBe(false);
  });
});
