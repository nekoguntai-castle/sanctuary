import { describe, expect, it } from 'vitest';
import { canEditWallet, canEditWalletRole } from '../../utils/walletCapabilities';

describe('walletCapabilities', () => {
  it('derives edit capability from valid wallet roles', () => {
    expect(canEditWalletRole('owner')).toBe(true);
    expect(canEditWalletRole('signer')).toBe(true);
    expect(canEditWalletRole('approver')).toBe(false);
    expect(canEditWalletRole('viewer')).toBe(false);
  });

  it('fails closed for malformed or missing roles', () => {
    expect(canEditWalletRole('editor')).toBe(false);
    expect(canEditWalletRole('')).toBe(false);
    expect(canEditWalletRole(null)).toBe(false);
    expect(canEditWalletRole(undefined)).toBe(false);
  });

  it('prefers explicit canEdit when present', () => {
    expect(canEditWallet({ canEdit: true, userRole: 'viewer' })).toBe(true);
    expect(canEditWallet({ canEdit: false, userRole: 'owner' })).toBe(false);
  });

  it('derives from role only when canEdit is absent', () => {
    expect(canEditWallet({ userRole: 'owner' })).toBe(true);
    expect(canEditWallet({ userRole: 'approver' })).toBe(false);
    expect(canEditWallet({ userRole: 'editor' })).toBe(false);
  });

  it('fails closed when the wallet object is missing', () => {
    expect(canEditWallet(null)).toBe(false);
    expect(canEditWallet(undefined)).toBe(false);
  });
});
