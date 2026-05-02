import { toTabNetwork, type TabNetwork } from "../src/app/networks";

type WalletLink = {
  wallet: {
    network?: string | null;
  };
};

type DeviceWithWalletLinks = {
  walletCount?: number;
  wallets?: WalletLink[];
};

export function scopeDeviceWalletsToNetwork<T extends DeviceWithWalletLinks>(
  device: T,
  network: TabNetwork,
): T {
  if (!device.wallets) return device;

  const wallets = device.wallets.filter(({ wallet }) => toTabNetwork(wallet.network) === network);
  return {
    ...device,
    wallets,
    walletCount: wallets.length,
  };
}

export function filterDevicesByNetwork<T extends DeviceWithWalletLinks>(
  devices: T[],
  network: TabNetwork,
): T[] {
  return devices.flatMap((device) => {
    if (!device.wallets || device.wallets.length === 0) return [device];

    const scoped = scopeDeviceWalletsToNetwork(device, network);
    return scoped.wallets && scoped.wallets.length > 0 ? [scoped] : [];
  });
}
