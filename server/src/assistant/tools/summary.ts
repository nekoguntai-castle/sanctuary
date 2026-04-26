type RecordLike = Record<string, any>;

export function satsString(value: bigint | number | string | null | undefined): string {
  return value === null || value === undefined ? '0' : value.toString();
}

function countValue(row: RecordLike | undefined): number {
  return row?._count?.id ?? 0;
}

function amountValue(row: RecordLike | undefined, field = 'amount'): string {
  return satsString(row?._sum?.[field]);
}

export function buildTransactionStats(input: RecordLike) {
  let totalCount = 0;
  let receivedCount = 0;
  let sentCount = 0;
  let consolidationCount = 0;
  let totalReceived = BigInt(0);
  let totalSent = BigInt(0);

  for (const row of input.typeStats ?? []) {
    const count = countValue(row);
    const amount = row._sum?.amount ?? BigInt(0);
    totalCount += count;
    // Transactions store received amounts positive and sent amounts negative; summaries expose magnitudes.
    if (row.type === 'received') {
      receivedCount = count;
      totalReceived = amount > 0n ? amount : -amount;
    } else if (row.type === 'sent') {
      sentCount = count;
      totalSent = amount < 0n ? -amount : amount;
    } else if (row.type === 'consolidation') {
      consolidationCount = count;
    }
  }

  return {
    totalCount,
    receivedCount,
    sentCount,
    consolidationCount,
    totalReceivedSats: totalReceived.toString(),
    totalSentSats: totalSent.toString(),
    totalFeesSats: satsString(input.feeStats?._sum?.fee),
    feeTransactionCount: countValue(input.feeStats),
    walletBalanceSats: satsString(input.lastTransaction?.balanceAfter),
  };
}

export function buildUtxoSummary(summary: RecordLike) {
  return {
    total: {
      count: countValue(summary.total),
      amountSats: amountValue(summary.total),
    },
    spendable: {
      count: countValue(summary.spendable),
      amountSats: amountValue(summary.spendable),
    },
    frozen: {
      count: countValue(summary.frozen),
      amountSats: amountValue(summary.frozen),
    },
    unconfirmed: {
      count: countValue(summary.unconfirmed),
      amountSats: amountValue(summary.unconfirmed),
    },
    lockedByDraft: {
      count: countValue(summary.locked),
      amountSats: amountValue(summary.locked),
    },
    spent: {
      count: countValue(summary.spent),
      amountSats: amountValue(summary.spent),
    },
  };
}

export function buildAddressSummary(summary: RecordLike) {
  let usedBalanceSats = '0';
  let unusedBalanceSats = '0';
  for (const row of summary.usedBalances ?? []) {
    if (row.used) {
      usedBalanceSats = satsString(row.balance);
    } else {
      unusedBalanceSats = satsString(row.balance);
    }
  }

  return {
    totalAddresses: summary.totalCount ?? 0,
    usedCount: summary.usedCount ?? 0,
    unusedCount: summary.unusedCount ?? 0,
    totalBalanceSats: satsString(summary.totalBalance?._sum?.amount),
    usedBalanceSats,
    unusedBalanceSats,
  };
}
