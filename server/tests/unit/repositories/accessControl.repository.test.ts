import { describe, expect, it } from 'vitest';

import {
  buildDeviceAccessWhere,
  buildWalletAccessWhere,
  buildWalletEditAccessWhere,
} from '../../../src/repositories/accessControl';

describe('repository accessControl helpers', () => {
  it('buildWalletAccessWhere includes direct and group membership access', () => {
    expect(buildWalletAccessWhere('user-1')).toEqual({
      OR: [
        { users: { some: { userId: 'user-1' } } },
        { group: { members: { some: { userId: 'user-1' } } } },
      ],
    });
  });

  it('buildWalletEditAccessWhere restricts direct and group access to edit-or-above roles', () => {
    expect(buildWalletEditAccessWhere('user-1')).toEqual({
      OR: [
        { users: { some: { userId: 'user-1', role: { in: ['owner', 'signer'] } } } },
        {
          users: { none: { userId: 'user-1' } },
          group: { members: { some: { userId: 'user-1' } } },
          groupRole: { in: ['owner', 'signer'] },
        },
      ],
    });
  });

  it('buildDeviceAccessWhere includes owner, shared, group, and wallet-derived access', () => {
    expect(buildDeviceAccessWhere('user-2')).toEqual({
      OR: [
        { userId: 'user-2' },
        { users: { some: { userId: 'user-2' } } },
        { group: { members: { some: { userId: 'user-2' } } } },
        {
          wallets: {
            some: {
              wallet: {
                OR: [
                  { users: { some: { userId: 'user-2' } } },
                  { group: { members: { some: { userId: 'user-2' } } } },
                ],
              },
            },
          },
        },
      ],
    });
  });
});
