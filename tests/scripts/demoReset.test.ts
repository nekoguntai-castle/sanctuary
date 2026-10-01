import { describe, expect, it } from 'vitest';
import { reset } from '../../scripts/demo/lib/seed.mjs';

const manifest = {
  agents: [], featureFlags: [], users: [], groups: [],
  wallets: [{ name: 'Everyday spending' }],
  devices: [{ fingerprint: '73c5da0a' }],
};

function fakeApi() {
  const deleted: string[] = [];
  const api = {
    deleted,
    get: async (path: string) => ({
      '/admin/agents': [],
      '/wallets': [{ id: 'w1', name: 'Everyday spending', userRole: 'owner' }],
      '/devices': [{ id: 'd1', fingerprint: '73c5da0a', isOwner: true, label: 'Coldcard Mk4' }],
      '/admin/groups': [],
      '/admin/users': [],
    } as Record<string, unknown>)[path],
    delete: async (path: string) => { deleted.push(path); },
    post: async () => undefined,
  };
  return api;
}

describe('demo reset', () => {
  it('deletes the seeded wallets and devices', async () => {
    const api = fakeApi();
    await reset(api, manifest, () => {});
    expect(api.deleted).toEqual(['/wallets/w1', '/devices/d1']);
  });

  it('keeps the test-vector devices while the canary fleet uses them', async () => {
    const api = fakeApi();
    const lines: string[] = [];
    await reset(api, manifest, (line: string) => lines.push(line), { keepDevices: true });
    expect(api.deleted).toEqual(['/wallets/w1']);
    expect(lines.join('\n')).toContain('canary fleet');
  });
});
