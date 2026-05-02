import { parseDerivationPath } from "../shared/utils/bitcoin";

type DerivationPathAccount = {
  derivationPath: string;
};

export type SplitTestnetSignetAccounts<T extends DerivationPathAccount> = {
  primaryAccounts: T[];
  testnetSignetAccounts: T[];
};

export function isTestnetSignetDerivationPath(path: string): boolean {
  const parsed = parseDerivationPath(path);
  // Signet uses the testnet-family BIP-44 coin type 1 for hardware paths.
  return parsed.valid && parsed.coinType === 1;
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
