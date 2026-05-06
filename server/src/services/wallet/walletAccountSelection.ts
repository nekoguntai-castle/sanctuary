/**
 * Wallet account selection
 *
 * Chooses the device account that matches wallet purpose, script type, and
 * network before descriptor construction.
 */

import { deviceRepository } from "../../repositories";
import { InvalidInputError } from "../../errors";
import { createLogger } from "../../utils/logger";
import * as descriptorBuilder from "../bitcoin/descriptorBuilder";
import { parseDerivationPath } from "../../../../shared/utils/bitcoin";
import type { CreateWalletInput, WalletNetwork } from "./types";

const log = createLogger("WALLET:SVC_ACCOUNT_SELECTION");

type WalletDevice = Awaited<
  ReturnType<typeof deviceRepository.findByIdsAndUserWithAccounts>
>[number];
type WalletDeviceAccount = WalletDevice["accounts"][number];
type AccountPurpose = "multisig" | "single_sig";

const PURPOSE_BY_WALLET_TYPE: Record<CreateWalletInput["type"], AccountPurpose> = {
  multi_sig: "multisig",
  single_sig: "single_sig",
};

const COIN_TYPE_BY_NETWORK: Record<WalletNetwork, number> = {
  mainnet: 0,
  regtest: 1,
  // Testnet-family networks share SLIP-44 coin type 1 in hardware wallet exports.
  signet: 1,
  testnet3: 1,
  testnet4: 1,
};

export function walletPurpose(input: CreateWalletInput): AccountPurpose {
  return PURPOSE_BY_WALLET_TYPE[input.type];
}

function requestedNetwork(input: CreateWalletInput): WalletNetwork {
  return input.network || "mainnet";
}

function requestedCoinType(input: CreateWalletInput): number {
  return COIN_TYPE_BY_NETWORK[requestedNetwork(input)];
}

function accountCoinType(account: WalletDeviceAccount): number | null {
  const parsed = parseDerivationPath(account.derivationPath);
  return parsed.valid ? parsed.coinType : null;
}

function deviceCoinType(device: WalletDevice): number | null {
  const parsed = parseDerivationPath(device.derivationPath);
  return parsed.valid ? parsed.coinType : null;
}

function accountMatchesNetwork(
  account: WalletDeviceAccount,
  input: CreateWalletInput,
): boolean {
  return accountCoinType(account) === requestedCoinType(input);
}

function accountHasUnknownNetwork(account: WalletDeviceAccount): boolean {
  return accountCoinType(account) === null;
}

function expectedAccountPath(input: CreateWalletInput): string {
  const network = requestedNetwork(input);
  if (input.type === "multi_sig") {
    return descriptorBuilder.getMultisigDerivationPath(
      input.scriptType,
      network,
    );
  }

  return descriptorBuilder.getDerivationPath(input.scriptType, network);
}

function missingAccountMessage(
  device: WalletDevice,
  input: CreateWalletInput,
): string {
  return (
    `Device "${device.label}" does not have a ${requestedNetwork(input)} ${walletPurpose(input)} ${input.scriptType} account. ` +
    `Add ${expectedAccountPath(input)} to the device, then create the wallet again.`
  );
}

function accountScope(
  device: WalletDevice,
  input: CreateWalletInput,
): WalletDeviceAccount[] {
  const networkMatches = device.accounts.filter((account) =>
    accountMatchesNetwork(account, input),
  );
  if (networkMatches.length > 0) return networkMatches;

  const unknownNetworkAccounts = device.accounts.filter(accountHasUnknownNetwork);
  if (unknownNetworkAccounts.length > 0) return unknownNetworkAccounts;

  if (device.accounts.length > 0) {
    throw new InvalidInputError(missingAccountMessage(device, input));
  }

  return device.accounts;
}

function assertLegacyDeviceMatchesNetwork(
  device: WalletDevice,
  input: CreateWalletInput,
): void {
  const coinType = deviceCoinType(device);
  if (coinType === null || coinType === requestedCoinType(input)) return;
  throw new InvalidInputError(missingAccountMessage(device, input));
}

function selectDeviceAccount(
  device: WalletDevice,
  input: CreateWalletInput,
): WalletDeviceAccount | undefined {
  const purpose = walletPurpose(input);
  const scopedAccounts = accountScope(device, input);
  const exactMatch = scopedAccounts.find(
    (account) =>
      account.purpose === purpose && account.scriptType === input.scriptType,
  );

  if (exactMatch) return exactMatch;

  const purposeMatch = scopedAccounts.find(
    (account) => account.purpose === purpose,
  );
  if (purposeMatch) return purposeMatch;

  if (device.accounts.length === 0) return undefined;

  log.warn("No matching account found for wallet type, using first account", {
    deviceId: device.id,
    fingerprint: device.fingerprint,
    walletType: input.type,
    scriptType: input.scriptType,
    network: requestedNetwork(input),
    availableAccounts: device.accounts.map((account) => ({
      purpose: account.purpose,
      scriptType: account.scriptType,
      derivationPath: account.derivationPath,
    })),
  });

  return scopedAccounts[0];
}

function warnIfUsingSingleSigForMultisig(
  device: WalletDevice,
  account: WalletDeviceAccount | undefined,
  input: CreateWalletInput,
): void {
  if (input.type !== "multi_sig" || account?.purpose !== "single_sig") {
    return;
  }

  log.warn(
    "Using single-sig account for multisig wallet - this may cause signing issues",
    {
      deviceId: device.id,
      fingerprint: device.fingerprint,
      accountPath: account.derivationPath,
      hint: "Consider adding a multisig account to this device",
    },
  );
}

export function buildDeviceInfo(device: WalletDevice, input: CreateWalletInput) {
  const account = selectDeviceAccount(device, input);
  if (!account) {
    assertLegacyDeviceMatchesNetwork(device, input);
  }
  const xpub = account?.xpub || device.xpub;
  const derivationPath = account?.derivationPath || device.derivationPath;

  warnIfUsingSingleSigForMultisig(device, account, input);

  return {
    fingerprint: device.fingerprint,
    xpub,
    derivationPath: derivationPath || undefined,
  };
}
