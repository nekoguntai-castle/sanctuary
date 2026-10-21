import { describe, expect, it } from 'vitest';
import {
  TESTNET_SINGLE_SIG_XPUB,
  app,
  authHeader,
  createAndLoginUser,
  createTestUser,
  prisma,
  request,
  uniqueFingerprint,
  uniqueUsername,
} from './walletIntegrationTestHarness';

const DERIVATION_PATH = "m/84'/1'/0'";

interface OwnedSigner {
  deviceId: string;
  deviceAccountId: string;
}

/** Owner B registers a single-sig signer that other users may see through a share. */
async function createOwnedSigner(ownerId: string): Promise<OwnedSigner> {
  const device = await prisma.device.create({
    data: {
      userId: ownerId,
      type: 'bitbox',
      label: 'Shared BitBox signer',
      fingerprint: uniqueFingerprint(),
      xpub: TESTNET_SINGLE_SIG_XPUB,
      derivationPath: DERIVATION_PATH,
    },
  });
  const account = await prisma.deviceAccount.create({
    data: {
      deviceId: device.id,
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: DERIVATION_PATH,
      xpub: TESTNET_SINGLE_SIG_XPUB,
    },
  });
  return { deviceId: device.id, deviceAccountId: account.id };
}

async function createOwnerWithSigner(): Promise<OwnedSigner> {
  const owner = await createTestUser(prisma, {
    username: uniqueUsername('device_owner'),
    password: 'OwnerPass123!',
  });
  return createOwnedSigner(owner.id);
}

async function shareThroughGroup(deviceId: string, memberId: string): Promise<void> {
  const group = await prisma.group.create({ data: { name: uniqueUsername('signer_group') } });
  await prisma.groupMember.create({ data: { userId: memberId, groupId: group.id } });
  await prisma.device.update({
    where: { id: deviceId },
    data: { groupId: group.id, groupRole: 'viewer' },
  });
}

function createWalletWithSigner(token: string, signer: OwnedSigner) {
  return request(app)
    .post('/api/v1/wallets')
    .set(authHeader(token))
    .send({
      name: 'Shared Signer Wallet',
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      signers: [{ ...signer, signerIndex: 0 }],
    });
}

async function expectWalletBindsSigner(walletId: string, signer: OwnedSigner): Promise<void> {
  const bindings = await prisma.walletDevice.findMany({ where: { walletId } });
  expect(bindings.map(binding => [binding.deviceId, binding.deviceAccountId]))
    .toEqual([[signer.deviceId, signer.deviceAccountId]]);
}

async function createEmptyOwnedWallet(userId: string): Promise<string> {
  const wallet = await prisma.wallet.create({
    data: {
      name: 'Wallet Awaiting Signer',
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      users: { create: { userId, role: 'owner' } },
    },
  });
  return wallet.id;
}

export function registerWalletSharedDeviceSignerTests(): void {
  describe('Shared device signers', () => {
    it('creates a wallet with a signer shared directly with the user as viewer', async () => {
      const signer = await createOwnerWithSigner();
      const { userId, token } = await createAndLoginUser(app, prisma);
      await prisma.deviceUser.create({ data: { deviceId: signer.deviceId, userId, role: 'viewer' } });

      const response = await createWalletWithSigner(token, signer);

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      await expectWalletBindsSigner(response.body.id, signer);
    });

    it('creates a wallet with a signer shared through a group the user belongs to', async () => {
      const signer = await createOwnerWithSigner();
      const { userId, token } = await createAndLoginUser(app, prisma);
      await shareThroughGroup(signer.deviceId, userId);

      const response = await createWalletWithSigner(token, signer);

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      await expectWalletBindsSigner(response.body.id, signer);
    });

    it('still rejects a signer the user has no access to', async () => {
      const signer = await createOwnerWithSigner();
      const { userId, token } = await createAndLoginUser(app, prisma);

      const response = await createWalletWithSigner(token, signer);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('DEVICE_NOT_FOUND');
      await expect(prisma.wallet.count({ where: { users: { some: { userId } } } })).resolves.toBe(0);
    });

    it('adds a signer shared with the user to the user\'s existing wallet', async () => {
      const signer = await createOwnerWithSigner();
      const { userId, token } = await createAndLoginUser(app, prisma);
      await prisma.deviceUser.create({ data: { deviceId: signer.deviceId, userId, role: 'viewer' } });
      const walletId = await createEmptyOwnedWallet(userId);

      const response = await request(app)
        .post(`/api/v1/wallets/${walletId}/devices`)
        .set(authHeader(token))
        .send({ ...signer, signerIndex: 0 });

      expect(response.status, JSON.stringify(response.body)).toBe(201);
      await expectWalletBindsSigner(walletId, signer);
    });
  });
}
