import { beforeEach, describe, expect, it } from 'vitest';
import '../walletImport.setup';
import { setupBeforeEach } from '../walletImport.setup';
import { mockPrismaClient } from '../../../mocks/prisma';
import { resolveDevices } from '../../../../src/services/walletImport/deviceResolution';

const userId = 'group-member';
const groupDevice = {
  id: 'group-device',
  userId: 'someone-else',
  type: 'coldcard',
  label: 'Shared Coldcard',
  fingerprint: 'abcd1234',
  model: null,
};

/** Returns the group device only when the query includes a group-membership branch. */
function visibleOnlyThroughGroup() {
  mockPrismaClient.device.findMany.mockImplementation(async (args: any) => {
    const branches: any[] = args?.where?.OR ?? [];
    const includesGroupBranch = branches.some(
      (b) => b.group?.members?.some?.userId === userId,
    );
    return includesGroupBranch ? [groupDevice] : [];
  });
}

describe('resolveDevices with group-shared signers', () => {
  beforeEach(() => {
    setupBeforeEach();
    visibleOnlyThroughGroup();
  });

  it('reuses a group-shared device that matches by fingerprint', async () => {
    const [resolution] = await resolveDevices(userId, [
      { fingerprint: 'ABCD1234', derivationPath: "m/84'/0'/0'", xpub: 'xpub-a' },
    ]);

    expect(resolution.willCreate).toBe(false);
    expect(resolution.existingDeviceId).toBe('group-device');
  });

  it('counts group device labels when deduplicating new device labels', async () => {
    const [resolution] = await resolveDevices(
      userId,
      [{ fingerprint: 'ffffffff', derivationPath: "m/84'/0'/0'", xpub: 'xpub-b' }],
      [{ label: 'Shared Coldcard' } as never],
    );

    expect(resolution.willCreate).toBe(true);
    expect(resolution.suggestedLabel).toBe('Shared Coldcard (2)');
  });
});
