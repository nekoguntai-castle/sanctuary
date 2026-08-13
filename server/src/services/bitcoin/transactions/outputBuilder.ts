/**
 * Output Builder
 *
 * Builds transaction outputs (recipient, change, decoy) for PSBT construction.
 * Handles output shuffling for privacy enhancement.
 */

import * as bitcoin from "bitcoinjs-lib";
import { addressRepository } from "../../../repositories";
import { createLogger } from "../../../utils/logger";
import { generateDecoyAmounts } from "../psbtBuilder";
import { shuffleInPlace } from "../secureRandom";
import type { PendingOutput, UtxoSelection } from "./types";
import { assertCanonicalAddressesForWallet } from "../../wallet/canonicalAddressValidation";

export interface PreparedChangeOutput {
  address: string;
  scriptPubKey: Uint8Array;
}

const log = createLogger("BITCOIN:SVC_TX_OUTPUT");

/**
 * Build all outputs (recipient, change, decoys) and add them to the PSBT in shuffled order.
 * The caller must supply the exact network-validated recipient script so every
 * address accepted by the production validator has identical send semantics.
 */
export async function buildAndAddOutputs(
  psbt: bitcoin.Psbt,
  walletId: string,
  recipient: string,
  effectiveAmount: number,
  selection: UtxoSelection,
  dustThreshold: number,
  sendMax: boolean,
  preparedChangeOutputs: readonly PreparedChangeOutput[],
  recipientScript: Uint8Array,
  decoyOutputs?: { enabled: boolean; count: number },
): Promise<{
  changeAddress?: string;
  decoyOutputsResult?: Array<{ address: string; amount: number }>;
  actualFee: number;
  actualChangeAmount: number;
}> {
  const pendingOutputs: PendingOutput[] = [];

  // Add recipient output
  pendingOutputs.push({
    address: recipient,
    script: recipientScript,
    value: effectiveAmount,
    type: "recipient",
  });

  let changeAddress: string | undefined;
  let decoyOutputsResult:
    | Array<{ address: string; amount: number }>
    | undefined;
  let actualFee = selection.estimatedFee;
  let actualChangeAmount = selection.changeAmount;

  if (!sendMax && selection.changeAmount >= dustThreshold) {
    const changeResult = await buildChangeOutputs(
      walletId,
      selection,
      dustThreshold,
      effectiveAmount,
      preparedChangeOutputs,
      decoyOutputs,
    );

    changeAddress = changeResult.changeAddress;
    decoyOutputsResult = changeResult.decoyOutputsResult;
    actualFee = changeResult.actualFee;
    actualChangeAmount = changeResult.actualChangeAmount;

    for (const output of changeResult.pendingOutputs) {
      pendingOutputs.push(output);
    }
  }

  // Shuffle outputs for privacy (Fisher-Yates algorithm)
  shuffleInPlace(pendingOutputs);

  // Add all outputs to PSBT in randomized order
  for (const output of pendingOutputs) {
    psbt.addOutput(output.script
      ? { script: output.script, value: BigInt(output.value) }
      : { address: output.address, value: BigInt(output.value) });
  }

  return { changeAddress, decoyOutputsResult, actualFee, actualChangeAmount };
}

/**
 * Build change outputs (single or decoy) for a transaction.
 */
async function buildChangeOutputs(
  walletId: string,
  selection: UtxoSelection,
  dustThreshold: number,
  effectiveAmount: number,
  preparedChangeOutputs: readonly PreparedChangeOutput[],
  decoyOutputs?: { enabled: boolean; count: number },
): Promise<{
  changeAddress?: string;
  decoyOutputsResult?: Array<{ address: string; amount: number }>;
  actualFee: number;
  actualChangeAmount: number;
  pendingOutputs: PendingOutput[];
}> {
  const pendingOutputs: PendingOutput[] = [];
  let actualFee = selection.estimatedFee;
  let actualChangeAmount = selection.changeAmount;

  const useDecoys = decoyOutputs?.enabled && decoyOutputs.count >= 2;
  const numChangeOutputs = useDecoys
    ? Math.min(Math.max(decoyOutputs.count, 2), 4)
    : 1;

  log.debug("Decoy calculation", {
    decoyOutputsParam: decoyOutputs,
    useDecoys,
    numChangeOutputs,
    changeAmount: selection.changeAmount,
    dustThreshold,
  });

  const canUseDecoys = useDecoys && selection.changeOutputCount === numChangeOutputs;

  if (canUseDecoys) {
    return buildDecoyChangeOutputs(
      walletId,
      numChangeOutputs,
      actualChangeAmount,
      dustThreshold,
      actualFee,
      preparedChangeOutputs,
    );
  }

  // Single change output
  const changeAddress = preparedChangeOutputs[0]?.address;
  if (!changeAddress) throw new Error("No prepared change address available");

  pendingOutputs.push({
    address: changeAddress,
    value: actualChangeAmount,
    type: "change",
  });

  return {
    changeAddress,
    actualFee,
    actualChangeAmount,
    pendingOutputs,
  };
}

/**
 * Build multiple decoy change outputs for privacy enhancement.
 */
async function buildDecoyChangeOutputs(
  walletId: string,
  numChangeOutputs: number,
  actualChangeAmount: number,
  dustThreshold: number,
  actualFee: number,
  preparedChangeOutputs: readonly PreparedChangeOutput[],
): Promise<{
  changeAddress?: string;
  decoyOutputsResult: Array<{ address: string; amount: number }>;
  actualFee: number;
  actualChangeAmount: number;
  pendingOutputs: PendingOutput[];
}> {
  const pendingOutputs: PendingOutput[] = [];

  if (preparedChangeOutputs.length < numChangeOutputs) {
    throw new Error(
      `Not enough change addresses for ${numChangeOutputs} decoy outputs`,
    );
  }

  // Generate decoy amounts
  const amounts = generateDecoyAmounts(
    actualChangeAmount,
    numChangeOutputs,
    dustThreshold,
  );

  // Shuffle addresses for additional obfuscation
  const shuffledAddresses = [...preparedChangeOutputs];
  shuffleInPlace(shuffledAddresses);

  let changeAddress: string | undefined;
  const decoyOutputsResult: Array<{ address: string; amount: number }> = [];

  for (let i = 0; i < numChangeOutputs; i++) {
    const addr = shuffledAddresses[i].address;
    const amt = amounts[i];

    pendingOutputs.push({
      address: addr,
      value: amt,
      type: i === 0 ? "change" : "decoy",
    });

    decoyOutputsResult.push({ address: addr, amount: amt });

    if (i === 0) {
      changeAddress = addr;
    }
  }

  log.info(`Created ${numChangeOutputs} decoy change outputs for wallet`);

  return {
    changeAddress,
    decoyOutputsResult,
    actualFee,
    actualChangeAmount,
    pendingOutputs,
  };
}

/**
 * Find an available change address for a wallet.
 */
export async function findChangeAddress(walletId: string): Promise<string> {
  return (await prepareChangeOutputs(walletId, 1))[0].address;
}

export async function prepareChangeOutputs(
  walletId: string,
  count: number,
): Promise<PreparedChangeOutput[]> {
  const rows = count === 1
    ? [await addressRepository.findNextUnusedChange(walletId)].filter((row): row is NonNullable<typeof row> => Boolean(row))
    : await addressRepository.findUnusedChangeAddresses(walletId, count);
  /* v8 ignore next -- both outcomes are tested; sharded V8 report merging records the false branch with a negative counter */
  if (rows.length < count) {
    if (count === 1) throw new Error('No change address available');
    throw new Error(`Not enough change addresses for ${count} change outputs`);
  }
  await assertCanonicalAddressesForWallet(walletId, rows, 1);
  return rows.map(row => {
    if (!row.scriptPubKey) throw new Error("Canonical change address is missing script evidence");
    return { address: row.address, scriptPubKey: Buffer.from(row.scriptPubKey, "hex") };
  });
}
