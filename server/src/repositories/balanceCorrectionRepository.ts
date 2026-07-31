import prisma from '../models/prisma';

/**
 * Atomically promotes a still-sent transaction to consolidation. `amount` is
 * the negative fee convention; the sent-type guard makes concurrent retries
 * idempotent.
 */
export async function correctTransactionToConsolidation(
  transactionId: string,
  amount: bigint,
  walletAddresses: string[],
): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const updated = await tx.transaction.updateMany({
      where: { id: transactionId, type: 'sent' },
      data: { type: 'consolidation', amount },
    });
    if (updated.count === 0) return false;

    await tx.transactionOutput.updateMany({
      where: {
        transactionId,
        address: { in: walletAddresses },
      },
      data: {
        isOurs: true,
        outputType: 'consolidation',
      },
    });
    return true;
  });
}

export const balanceCorrectionRepository = {
  correctTransactionToConsolidation,
};

export default balanceCorrectionRepository;
