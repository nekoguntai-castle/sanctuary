import { describe, expect, it } from 'vitest';
import { seed } from '../../scripts/demo/lib/seed.mjs';

const manifest = {
  demoUser: { preferences: { darkMode: true } },
  users: [
    { username: 'alice', email: 'alice@demo.invalid', isAdmin: false },
    { username: 'bob', email: 'bob@demo.invalid', isAdmin: false },
  ],
  groups: [{ name: 'Family', description: 'Household', purpose: 'demo', members: ['alice', 'bob'] }],
  wallets: [{ name: 'Everyday spending', descriptor: 'd', network: 'mainnet', shares: [{ username: 'alice', role: 'viewer' }] }],
  devices: [],
  agents: [],
  featureFlags: [],
};

type Lists = { users: unknown[]; groups: unknown[] };

// Records every non-GET call so a refusal can assert that nothing was written.
function fakeApi({ users, groups }: Lists) {
  const writes: string[] = [];
  const record = (verb: string) => async (path: string) => {
    writes.push(`${verb} ${path}`);
    return { id: 'new', wallet: { id: 'w1' }, message: 'ok' };
  };
  return {
    writes,
    get: async (path: string) => {
      if (path === '/admin/users') return users;
      if (path === '/admin/groups') return groups;
      if (path === '/wallets') return [];
      if (path === '/auth/me') return { id: 'me' };
      if (path.startsWith('/sync/status/')) return { syncInProgress: false, syncStatus: 'success' };
      return [];
    },
    post: record('POST'),
    patch: record('PATCH'),
    put: record('PUT'),
    delete: record('DELETE'),
  };
}

const demoUsers = [
  { id: 'u1', username: 'alice', email: 'alice@demo.invalid' },
  { id: 'u2', username: 'bob', email: 'bob@demo.invalid' },
];

describe('demo seed marker checks', () => {
  it('refuses to adopt a real user with a manifest username and writes nothing', async () => {
    const api = fakeApi({
      users: [{ id: 'u1', username: 'alice', email: 'alice@real.example' }],
      groups: [],
    });
    await expect(seed(api, manifest, () => {})).rejects.toThrow('not a demo user');
    expect(api.writes).toEqual([]);
  });

  it('refuses a conflict on a later manifest entry before any write, including the preferences PATCH', async () => {
    const lastUser = fakeApi({
      users: [{ id: 'u2', username: 'bob', email: 'bob@real.example' }],
      groups: [],
    });
    await expect(seed(lastUser, manifest, () => {})).rejects.toThrow('not a demo user');
    expect(lastUser.writes).toEqual([]);

    const group = fakeApi({
      users: [],
      groups: [{ id: 'g1', name: 'Family', purpose: null, description: 'Our family' }],
    });
    await expect(seed(group, manifest, () => {})).rejects.toThrow('not a demo group');
    expect(group.writes).toEqual([]);
  });

  it('adopts the demo-marked users and groups it created earlier', async () => {
    const api = fakeApi({
      users: demoUsers,
      groups: [{ id: 'g1', name: 'Family', purpose: 'demo', description: 'edited by an operator' }],
    });
    await seed(api, manifest, () => {});
    expect(api.writes).toContain('PATCH /auth/me/preferences');
    expect(api.writes).not.toContain('POST /admin/users');
    expect(api.writes).not.toContain('POST /admin/groups');
  });
});
