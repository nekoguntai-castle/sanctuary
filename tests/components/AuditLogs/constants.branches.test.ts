import { describe,expect,it } from 'vitest';
import { formatAction } from '../../../src/components/AuditLogs/constants';

describe('AuditLogs constants branch coverage', () => {
  it('formats action names from dotted/snake case', () => {
    expect(formatAction('wallet.create_new')).toBe('Wallet - Create New');
    expect(formatAction('admin.settings.update_theme')).toBe('Admin - Settings - Update Theme');
  });

});
