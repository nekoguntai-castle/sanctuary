import { parseDerivationPath } from "@sanctuary/shared/utils/bitcoin";
import {
  coinTypeForNetwork,
  networksShareCoinType,
  type TabNetwork,
} from "../src/app/networks";

type DerivationPathAccount = {
  derivationPath: string;
};

export type DeviceAccountPurpose = "single_sig" | "multisig";
export type DerivationNetworkGroup = "mainnet" | "testnet-signet";

export type SplitTestnetSignetAccounts<T extends DerivationPathAccount> = {
  primaryAccounts: T[];
  testnetSignetAccounts: T[];
};

export type NetworkGroupedAccounts<T extends DerivationPathAccount> = Record<
  DerivationNetworkGroup,
  T[]
>;

export type PurposeGroupedAccounts<T extends { purpose: DeviceAccountPurpose }> = Record<
  DeviceAccountPurpose,
  T[]
>;

export function derivationPathCoinType(path: string): number | null {
  const parsed = parseDerivationPath(path);
  return parsed.valid ? parsed.coinType : null;
}

export function isTestnetSignetDerivationPath(path: string): boolean {
  // Signet uses the testnet-family BIP-44 coin type 1 for hardware paths.
  return derivationPathCoinType(path) === 1;
}

export function derivationPathMatchesNetwork(path: string, network: TabNetwork): boolean {
  const coinType = derivationPathCoinType(path);
  // Preserve unparseable paths in all network views so imported account data remains visible for audit.
  return coinType === null || coinType === coinTypeForNetwork(network);
}

export function derivationNetworkGroup(path: string): DerivationNetworkGroup {
  return isTestnetSignetDerivationPath(path) ? "testnet-signet" : "mainnet";
}

export function networkGroupMatchesNetwork(
  group: DerivationNetworkGroup,
  network: TabNetwork,
): boolean {
  const groupNetwork = group === "mainnet" ? "mainnet" : "testnet";
  return networksShareCoinType(groupNetwork, network);
}

export function splitTestnetSignetAccounts<T extends DerivationPathAccount>(
  accounts: T[],
): SplitTestnetSignetAccounts<T> {
  return accounts.reduce<SplitTestnetSignetAccounts<T>>(
    (groups, account) => {
      if (isTestnetSignetDerivationPath(account.derivationPath)) {
        groups.testnetSignetAccounts.push(account);
      } else {
        groups.primaryAccounts.push(account);
      }
      return groups;
    },
    { primaryAccounts: [], testnetSignetAccounts: [] },
  );
}

export function groupAccountsByNetwork<T extends DerivationPathAccount>(
  accounts: T[],
): NetworkGroupedAccounts<T> {
  return accounts.reduce<NetworkGroupedAccounts<T>>(
    (groups, account) => {
      groups[derivationNetworkGroup(account.derivationPath)].push(account);
      return groups;
    },
    { mainnet: [], "testnet-signet": [] },
  );
}

export function groupAccountsByPurpose<T extends { purpose: DeviceAccountPurpose }>(
  accounts: T[],
): PurposeGroupedAccounts<T> {
  return accounts.reduce<PurposeGroupedAccounts<T>>(
    (groups, account) => {
      groups[account.purpose].push(account);
      return groups;
    },
    { single_sig: [], multisig: [] },
  );
}
