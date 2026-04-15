import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findByIdWithSelect: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  userRepository: {
    findByIdWithSelect: mocks.findByIdWithSelect,
  },
}));

vi.mock('../../../src/utils/password', () => ({
  verifyPassword: mocks.verifyPassword,
}));

const loadService = async () => {
  vi.resetModules();
  return import('../../../src/services/adminCredentialService');
};

describe('adminCredentialService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when the admin password matches the stored password hash', async () => {
    mocks.findByIdWithSelect.mockResolvedValueOnce({ password: 'hashed-password' });
    mocks.verifyPassword.mockResolvedValueOnce(true);
    const { verifyAdminPassword } = await loadService();

    await expect(verifyAdminPassword('admin-1', 'candidate-password')).resolves.toBe(true);

    expect(mocks.findByIdWithSelect).toHaveBeenCalledWith('admin-1', { password: true });
    expect(mocks.verifyPassword).toHaveBeenCalledWith('candidate-password', 'hashed-password');
  });

  it('returns false when the user no longer exists', async () => {
    mocks.findByIdWithSelect.mockResolvedValueOnce(null);
    const { verifyAdminPassword } = await loadService();

    await expect(verifyAdminPassword('missing-admin', 'candidate-password')).resolves.toBe(false);

    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });
});
