import type { CSSProperties } from "react";
import { calculateUTXOAge } from "../../../utils/utxoAge";
import { getSpendCost, isDustUtxo } from "../dustUtils";
import type { UTXO } from "../../../types";
import type { CreateUtxoGardenDotModelArgs, UtxoGardenDotModel } from "./types";

const DAY_MS = 86400000;
const MIN_SIZE = 14;
const MAX_SIZE = 48;

export const FROZEN_STYLE: CSSProperties = {
  background: `repeating-linear-gradient(
    45deg,
    #e05a47,
    #e05a47 4px,
    #c44a3a 4px,
    #c44a3a 8px
  )`,
};

export const LOCKED_STYLE: CSSProperties = {
  background: `repeating-linear-gradient(
    45deg,
    #06b6d4,
    #06b6d4 4px,
    #0891b2 4px,
    #0891b2 8px
  )`,
};

export const DUST_STYLE: CSSProperties = {
  background: `radial-gradient(circle at 25% 25%, #f59e0b 2px, transparent 2px),
               radial-gradient(circle at 75% 75%, #f59e0b 2px, transparent 2px),
               #d97706`,
};

export function getMaxUtxoAmount(utxos: UTXO[]): number {
  return Math.max(...utxos.map((utxo) => utxo.amount), 1);
}

export const createUtxoGardenDotModel = (
  args: CreateUtxoGardenDotModelArgs,
): UtxoGardenDotModel => {
  const { utxo, selectedUtxos, currentFeeRate, maxAmount, now, format } = args;
  const id = `${utxo.txid}:${utxo.vout}`;
  const isLocked = Boolean(utxo.lockedByDraftId);
  const isDisabled = Boolean(utxo.frozen || isLocked);
  const isDust = !utxo.frozen && !isLocked && isDustUtxo(utxo, currentFeeRate);
  const spendCost = isDust ? getSpendCost(utxo, currentFeeRate) : 0;
  const statusLabel = getStatusLabel({
    utxo,
    isLocked,
    isDust,
    spendCost,
    format,
  });
  const formattedAmount = format(utxo.amount);

  return {
    id,
    size: getSize(utxo.amount, maxAmount),
    style: getPatternStyle({ utxo, isLocked, isDust }),
    colorClass: getColorClass({ utxo, isLocked, isDust, now }),
    isDisabled,
    isSelected: selectedUtxos.has(id),
    title: `${formattedAmount} - ${calculateUTXOAge(utxo).displayText} old - ${utxo.label || "No Label"} ${statusLabel}`,
    formattedAmount,
  };
};

function getColorClass({
  utxo,
  isLocked,
  isDust,
  now,
}: {
  utxo: UTXO;
  isLocked: boolean;
  isDust: boolean;
  now: number;
}): string {
  if (utxo.frozen || isLocked || isDust) {
    return "";
  }

  return getAgeColor(getUtxoTimestamp(utxo, now), now);
}

function getAgeColor(timestamp: number, now: number): string {
  const age = now - timestamp;

  if (age < DAY_MS) {
    return "bg-zen-matcha border-zen-matcha";
  }

  if (age < DAY_MS * 30) {
    return "bg-zen-indigo border-zen-indigo";
  }

  if (age < DAY_MS * 365) {
    return "bg-zen-gold border-zen-gold";
  }

  return "bg-sanctuary-700 border-sanctuary-700";
}

function getUtxoTimestamp(utxo: UTXO, now: number): number {
  return typeof utxo.date === "string"
    ? new Date(utxo.date).getTime()
    : (utxo.date ?? now);
}

function getSize(amount: number, maxAmount: number): number {
  const ratio = Math.sqrt(amount / maxAmount);
  return Math.round(MIN_SIZE + ratio * (MAX_SIZE - MIN_SIZE));
}

function getPatternStyle({
  utxo,
  isLocked,
  isDust,
}: {
  utxo: UTXO;
  isLocked: boolean;
  isDust: boolean;
}): CSSProperties {
  if (utxo.frozen) {
    return FROZEN_STYLE;
  }

  if (isLocked) {
    return LOCKED_STYLE;
  }

  if (isDust) {
    return DUST_STYLE;
  }

  return {};
}

function getStatusLabel({
  utxo,
  isLocked,
  isDust,
  spendCost,
  format,
}: {
  utxo: UTXO;
  isLocked: boolean;
  isDust: boolean;
  spendCost: number;
  format: (sats: number) => string;
}): string {
  if (utxo.frozen) {
    return "(Frozen)";
  }

  if (isLocked) {
    return `(Locked: ${utxo.lockedByDraftLabel || "Draft"})`;
  }

  if (isDust) {
    return `(Dust - costs ${format(spendCost)} to spend)`;
  }

  return "";
}
