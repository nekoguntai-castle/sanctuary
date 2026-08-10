import {
  createTestDevice,
  createTestUser,
  createTestWallet,
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
} from './setup';

const signerSnapshot = {
  signerIndex: 0,
  signerBindingVersion: 1,
  signerFingerprint: 'aabbccdd',
  signerXpub: 'tpub-bound-signer',
  signerDerivationPath: "m/84'/1'/0'",
  signerPurpose: 'single_sig',
  signerScriptType: 'native_segwit',
} as const;

describeIfDatabase('WalletDevice signer binding constraints', () => {
  setupRepositoryTests();

  it('keeps existing-style links legacy-null while accepting complete snapshots', async () => {
    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const legacyDevice = await createTestDevice(tx, user.id);
      const boundDevice = await createTestDevice(tx, user.id);
      const account = await tx.deviceAccount.create({
        data: {
          deviceId: boundDevice.id,
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: signerSnapshot.signerXpub,
        },
      });

      const legacy = await tx.walletDevice.create({
        data: { walletId: wallet.id, deviceId: legacyDevice.id },
      });
      const bound = await tx.walletDevice.create({
        data: {
          walletId: wallet.id,
          deviceId: boundDevice.id,
          deviceAccountId: account.id,
          ...signerSnapshot,
        },
      });

      expect(legacy.signerBindingVersion).toBeNull();
      expect(bound.deviceAccountId).toBe(account.id);
      expect(bound.signerDerivationPath).toBe(signerSnapshot.signerDerivationPath);
    });
  });

  it('rejects a partial signer snapshot', async () => {
    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const device = await createTestDevice(tx, user.id);

      await expect(tx.walletDevice.create({
        data: {
          walletId: wallet.id,
          deviceId: device.id,
          signerBindingVersion: 1,
          signerIndex: 0,
        },
      })).rejects.toThrow();
    });
  });

  it('rejects an account owned by a different device', async () => {
    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const linkedDevice = await createTestDevice(tx, user.id);
      const accountDevice = await createTestDevice(tx, user.id);
      const account = await tx.deviceAccount.create({
        data: {
          deviceId: accountDevice.id,
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: signerSnapshot.signerXpub,
        },
      });

      await expect(tx.walletDevice.create({
        data: {
          walletId: wallet.id,
          deviceId: linkedDevice.id,
          deviceAccountId: account.id,
          ...signerSnapshot,
        },
      })).rejects.toThrow();
    });
  });

  it('freezes completed snapshots and wallet-local signer slots', async () => {
    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const firstDevice = await createTestDevice(tx, user.id);
      const link = await tx.walletDevice.create({
        data: { walletId: wallet.id, deviceId: firstDevice.id, ...signerSnapshot },
      });

      await expect(tx.walletDevice.update({
        where: { id: link.id },
        data: { signerXpub: 'tpub-rewritten' },
      })).rejects.toThrow();
    });

    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const firstDevice = await createTestDevice(tx, user.id);
      const secondDevice = await createTestDevice(tx, user.id);
      await tx.walletDevice.create({
        data: { walletId: wallet.id, deviceId: firstDevice.id, ...signerSnapshot },
      });
      await expect(tx.walletDevice.create({
        data: { walletId: wallet.id, deviceId: secondDevice.id, ...signerSnapshot },
      })).rejects.toThrow();
    });
  });

  it('protects bound account and device identity until explicit unlink', async () => {
    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const device = await createTestDevice(tx, user.id);
      const account = await tx.deviceAccount.create({
        data: {
          deviceId: device.id,
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: signerSnapshot.signerXpub,
        },
      });
      await tx.walletDevice.create({
        data: {
          walletId: wallet.id,
          deviceId: device.id,
          deviceAccountId: account.id,
          ...signerSnapshot,
        },
      });

      await expect(tx.deviceAccount.update({
        where: { id: account.id },
        data: { derivationPath: "m/84'/1'/1'" },
      })).rejects.toThrow();
    });

    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const device = await createTestDevice(tx, user.id);
      await tx.walletDevice.create({
        data: { walletId: wallet.id, deviceId: device.id, ...signerSnapshot },
      });
      await expect(tx.device.delete({ where: { id: device.id } })).rejects.toThrow();
    });
  });

  it('rejects deleting an account while it is bound', async () => {
    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const device = await createTestDevice(tx, user.id);
      const account = await tx.deviceAccount.create({
        data: {
          deviceId: device.id,
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: signerSnapshot.signerXpub,
        },
      });
      await tx.walletDevice.create({
        data: {
          walletId: wallet.id,
          deviceId: device.id,
          deviceAccountId: account.id,
          ...signerSnapshot,
        },
      });

      await expect(tx.deviceAccount.delete({ where: { id: account.id } })).rejects.toThrow();
    });
  });

  it('allows one explicit legacy-null to proven-snapshot transition', async () => {
    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const device = await createTestDevice(tx, user.id);
      const account = await tx.deviceAccount.create({
        data: {
          deviceId: device.id,
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: signerSnapshot.signerXpub,
        },
      });
      const legacy = await tx.walletDevice.create({
        data: { walletId: wallet.id, deviceId: device.id },
      });

      const bound = await tx.walletDevice.update({
        where: { id: legacy.id },
        data: { deviceAccountId: account.id, ...signerSnapshot },
      });

      expect(bound.signerBindingVersion).toBe(1);
      expect(bound.deviceAccountId).toBe(account.id);
    });
  });

  it('allows account and device lifecycle changes after explicit unlink', async () => {
    await withTestTransaction(async (tx) => {
      const user = await createTestUser(tx);
      const wallet = await createTestWallet(tx, user.id);
      const device = await createTestDevice(tx, user.id);
      const account = await tx.deviceAccount.create({
        data: {
          deviceId: device.id,
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/1'/0'",
          xpub: signerSnapshot.signerXpub,
        },
      });
      const link = await tx.walletDevice.create({
        data: {
          walletId: wallet.id,
          deviceId: device.id,
          deviceAccountId: account.id,
          ...signerSnapshot,
        },
      });

      await tx.walletDevice.delete({ where: { id: link.id } });
      await expect(tx.deviceAccount.update({
        where: { id: account.id },
        data: { derivationPath: "m/84'/1'/1'" },
      })).resolves.toEqual(expect.objectContaining({ derivationPath: "m/84'/1'/1'" }));
      await tx.deviceAccount.delete({ where: { id: account.id } });
      await expect(tx.device.delete({ where: { id: device.id } })).resolves.toEqual(
        expect.objectContaining({ id: device.id }),
      );
    });
  });
});
