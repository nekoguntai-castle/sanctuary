import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ updateAtomically: vi.fn(), getAll: vi.fn(), findByKeys: vi.fn(), set: vi.fn(), clear: vi.fn() }));
vi.mock('../../../src/repositories', () => ({ systemSettingRepository: mocks }));
vi.mock('../../../src/services/email', () => ({ clearTransporterCache: mocks.clear }));
vi.mock('../../../src/utils/encryption', () => ({ encrypt: (value: string) => `enc:${value}`, isEncrypted: (value: string) => value.startsWith('enc:') }));
import { updateAdminSettings } from '../../../src/services/adminSettingsService';
beforeEach(() => vi.resetAllMocks());
it('revalidates a partial update using the fresh retry snapshot', async () => {
  mocks.updateAtomically.mockImplementation(derive => {
    expect(derive([{ key: 'confirmationThreshold', value: '1' }])).toEqual([{ key: 'deepConfirmationThreshold', value: '3' }]);
    return derive([{ key: 'confirmationThreshold', value: '6' }]);
  });
  await expect(updateAdminSettings({ deepConfirmationThreshold: 3 })).rejects.toMatchObject({ statusCode: 400 });
  expect(mocks.findByKeys).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});
it('uses committed rows for response and clears SMTP cache only after commit', async () => {
  mocks.updateAtomically.mockImplementation(async derive => {
    const rows = derive([]);
    expect(mocks.clear).not.toHaveBeenCalled();
    return rows;
  });
  const response = await updateAdminSettings({ 'smtp.host': 'mail', 'smtp.password': 'secret' });
  expect(response['smtp.host']).toBe('mail');
  expect(response['smtp.password']).toBeUndefined();
  expect(mocks.clear).toHaveBeenCalledTimes(1);
  expect(mocks.getAll).not.toHaveBeenCalled();
});
it('does not clear cache when the transaction fails after deriving writes', async () => {
  mocks.updateAtomically.mockImplementation(async derive => { derive([]); throw new Error('commit failed'); });
  await expect(updateAdminSettings({ 'smtp.host': 'mail' })).rejects.toThrow('commit failed');
  expect(mocks.clear).not.toHaveBeenCalled();
});
it.each(['', 'enc:existing'])('preserves SMTP password value %j without re-encryption', async password => {
  mocks.updateAtomically.mockImplementation(async derive => {
    const rows = derive([]);
    expect(rows).toEqual([{ key: 'smtp.password', value: JSON.stringify(password) }]);
    return rows;
  });
  await updateAdminSettings({ 'smtp.password': password });
});
it('validates missing thresholds with defaults while ignoring unrelated raw settings', async () => {
  mocks.updateAtomically.mockImplementation(async derive => derive([{ key: 'smtp.host', value: '"mail"' }]));
  const result = await updateAdminSettings({ deepConfirmationThreshold: 3 });
  expect(result.confirmationThreshold).toBe(1);
  expect(result.deepConfirmationThreshold).toBe(3);
  expect(mocks.findByKeys).not.toHaveBeenCalled();
});
