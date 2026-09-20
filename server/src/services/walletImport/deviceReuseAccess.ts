/** Recheck imported device access inside the import transaction. The canonical
 * deviceAccess service reads through a separate client, so it cannot see this
 * transaction's relationships. A direct grant takes precedence over group access.
 */
import { parseDeviceRole, type DeviceRole } from '@sanctuary/shared/constants/deviceRoles';
import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import { accountPurposeForWalletType, type WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { ForbiddenError } from '../../errors';
import type { PrismaTxClient } from '../../models/prisma';
import { createLogger } from '../../utils/logger';
import type { DeviceResolution, ImportedDeviceInfo } from './types';

const log = createLogger('WALLET_IMPORT:SVC');

async function getCurrentDeviceRole(
  tx: PrismaTxClient,
  deviceId: string,
  userId: string,
): Promise<DeviceRole> {
  const device = await tx.device.findUnique({
    where: { id: deviceId },
    select: {
      users: { where: { userId }, select: { role: true } },
      groupRole: true,
      group: { select: { members: { where: { userId }, select: { userId: true } } } },
    },
  });
  if (!device) return null;
  if (device.users.length > 0) return parseDeviceRole(device.users[0].role);
  return device.group?.members.length ? parseDeviceRole(device.groupRole) : null;
}

/** Existing account reuse needs view access; account creation needs owner access. */
export async function assertDeviceReuseAccess(
  tx: PrismaTxClient,
  deviceId: string,
  userId: string,
  addingAccount: boolean,
): Promise<void> {
  const role = await getCurrentDeviceRole(tx, deviceId, userId);
  if (role === null) throw new ForbiddenError('Current device access is required for wallet import');
  if (addingAccount && role !== 'owner') {
    throw new ForbiddenError('Device owner access is required to add an account during wallet import');
  }
}

interface ReuseContext {
  userId: string;
  accountPurpose: ReturnType<typeof accountPurposeForWalletType>;
  scriptType: WalletScriptType;
}

/** Materialize a resolved existing device without exceeding the current grant. */
export async function reuseImportedDevice(
  tx: PrismaTxClient,
  resolution: DeviceResolution,
  context: ReuseContext,
): Promise<{ created: false; info: ImportedDeviceInfo }> {
  const deviceId = resolution.existingDeviceId;
  if (!deviceId) throw new Error('Existing device resolution is missing device id');
  await assertDeviceReuseAccess(tx, deviceId, context.userId, false);
  const existingAccounts = await tx.deviceAccount.findMany({ where: { deviceId } });
  const derivationPath = normalizeDerivationPath(resolution.derivationPath);
  const accountsAtPath = existingAccounts.filter(
    (account) => normalizeDerivationPath(account.derivationPath) === derivationPath,
  );
  if (accountsAtPath.length > 1) {
    throw new Error(`Existing device account path ${derivationPath} is ambiguous`);
  }
  const [accountAtPath] = accountsAtPath;
  const matches = accountAtPath !== undefined
    && accountAtPath.purpose === context.accountPurpose
    && accountAtPath.scriptType === context.scriptType
    && accountAtPath.xpub === resolution.xpub;
  if (accountAtPath && !matches) {
    // One account path cannot bind to different signer key material or script policy.
    throw new Error(`Existing device account at ${derivationPath} does not exactly match the imported signer`);
  }
  // Narrow the window for revocation before a new account is inserted.
  if (!matches) await assertDeviceReuseAccess(tx, deviceId, context.userId, true);
  const account = matches && accountAtPath
    ? accountAtPath
    : await tx.deviceAccount.create({
      data: {
        deviceId,
        purpose: context.accountPurpose,
        scriptType: context.scriptType,
        derivationPath,
        xpub: resolution.xpub,
      },
    });
  /* v8 ignore next -- account creation and exact reuse are asserted by contracts */
  if (!matches) {
    log.info('Added new device account for import', {
      deviceId,
      purpose: context.accountPurpose,
      derivationPath,
    });
  }
  return {
    created: false,
    info: {
      deviceId,
      deviceAccountId: account.id,
      fingerprint: resolution.fingerprint,
      xpub: resolution.xpub,
      derivationPath,
      purpose: context.accountPurpose,
      scriptType: context.scriptType,
    },
  };
}
