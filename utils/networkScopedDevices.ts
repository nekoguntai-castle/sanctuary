import { toTabNetwork, type TabNetwork } from "../src/app/networks";
import { derivationPathMatchesNetwork } from "./derivationPathGroups";

type WalletLink = {
  wallet: {
    network?: string | null;
  };
};

type DeviceAccountLink = {
  derivationPath?: string | null;
};

type DeviceWithWalletLinks = {
  derivationPath?: string | null;
  accounts?: DeviceAccountLink[];
  walletCount?: number;
  wallets?: WalletLink[];
};

export function scopeDeviceWalletsToNetwork<T extends DeviceWithWalletLinks>(
  device: T,
  network: TabNetwork,
): T {
  if (!device.wallets || device.wallets.length === 0) return device;

  const wallets = device.wallets.filter(({ wallet }) => toTabNetwork(wallet.network) === network);
  return {
    ...device,
    wallets,
    walletCount: wallets.length,
  };
}

function deviceHasUsableDerivationPathForNetwork(
  device: DeviceWithWalletLinks,
  network: TabNetwork,
): boolean {
  const derivationPaths = [
    ...(device.accounts ?? []).map((account) => account.derivationPath),
    device.derivationPath,
  ].filter((path): path is string => Boolean(path));

  if (derivationPaths.length === 0) return true;

  return derivationPaths.some((path) => derivationPathMatchesNetwork(path, network));
}

export function filterDevicesByNetwork<T extends DeviceWithWalletLinks>(
  devices: T[],
  network: TabNetwork,
): T[] {
  return devices.flatMap((device) => {
    if (!deviceHasUsableDerivationPathForNetwork(device, network)) return [];

    const scoped = scopeDeviceWalletsToNetwork(device, network);
    return [scoped];
  });
}
