/**
 * Label Repository Factory
 *
 * Creates the label repository with injectable Prisma client.
 * Extracted from factory.ts due to being the largest single factory (173 lines).
 */

import type { PrismaClientLike, LabelRepositoryInterface, LabelWithAssociations } from './factoryInterfaces';

/**
 * Create label repository with injectable client
 */
export function createLabelRepository(client: PrismaClientLike): LabelRepositoryInterface {
  return {
    async findByWalletId(walletId: string) {
      const labels = await client.label.findMany({
        where: { walletId },
        include: {
          _count: {
            select: {
              transactionLabels: true,
              addressLabels: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });
      return labels.map(label => ({
        ...label,
        transactionCount: label._count.transactionLabels,
        addressCount: label._count.addressLabels,
      }));
    },

    async findById(labelId: string) {
      return client.label.findUnique({ where: { id: labelId } });
    },

    async findByIdInWallet(labelId: string, walletId: string) {
      return client.label.findFirst({ where: { id: labelId, walletId } });
    },

    async findByIdWithAssociations(labelId: string, walletId: string): Promise<LabelWithAssociations | null> {
      const label = await client.label.findFirst({
        where: { id: labelId, walletId },
        include: {
          transactionLabels: {
            include: {
              transaction: {
                select: {
                  id: true,
                  txid: true,
                  type: true,
                  amount: true,
                  confirmations: true,
                  blockTime: true,
                },
              },
            },
          },
          addressLabels: {
            include: {
              address: {
                select: {
                  id: true,
                  address: true,
                  derivationPath: true,
                  index: true,
                  used: true,
                },
              },
            },
          },
        },
      });

      if (!label) return null;

      return {
        ...label,
        transactions: label.transactionLabels.map(tl => tl.transaction),
        addresses: label.addressLabels.map(al => al.address),
      };
    },

    async findByNameInWallet(walletId: string, name: string) {
      return client.label.findFirst({ where: { walletId, name } });
    },

    async isNameTakenByOther(walletId: string, name: string, excludeLabelId: string) {
      const label = await client.label.findFirst({
        where: { walletId, name, id: { not: excludeLabelId } },
        select: { id: true },
      });
      return label !== null;
    },

    async findManyByIdsInWallet(labelIds: string[], walletId: string) {
      return client.label.findMany({
        where: { id: { in: labelIds }, walletId },
      });
    },

    async create(data) {
      return client.label.create({
        data: {
          walletId: data.walletId,
          name: data.name.trim(),
          color: data.color || '#6366f1',
          description: data.description || null,
        },
      });
    },

    async update(labelId: string, data) {
      return client.label.update({
        where: { id: labelId },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.color !== undefined && { color: data.color }),
          ...(data.description !== undefined && { description: data.description }),
        },
      });
    },

    async remove(labelId: string) {
      await client.label.delete({ where: { id: labelId } });
    },

    async getLabelsForTransaction(transactionId: string) {
      const associations = await client.transactionLabel.findMany({
        where: { transactionId },
        include: { label: true },
      });
      return associations.map(a => a.label);
    },

    async addLabelsToTransaction(transactionId: string, labelIds: string[]) {
      await client.transactionLabel.createMany({
        data: labelIds.map(labelId => ({ transactionId, labelId })),
        skipDuplicates: true,
      });
    },

    async replaceTransactionLabels(transactionId: string, labelIds: string[]) {
      await client.$transaction([
        client.transactionLabel.deleteMany({ where: { transactionId } }),
        client.transactionLabel.createMany({
          data: labelIds.map(labelId => ({ transactionId, labelId })),
        }),
      ]);
    },

    async removeLabelFromTransaction(transactionId: string, labelId: string) {
      await client.transactionLabel.deleteMany({ where: { transactionId, labelId } });
    },

    async getLabelsForAddress(addressId: string) {
      const associations = await client.addressLabel.findMany({
        where: { addressId },
        include: { label: true },
      });
      return associations.map(a => a.label);
    },

    async addLabelsToAddress(addressId: string, labelIds: string[]) {
      await client.addressLabel.createMany({
        data: labelIds.map(labelId => ({ addressId, labelId })),
        skipDuplicates: true,
      });
    },

    async replaceAddressLabels(addressId: string, labelIds: string[]) {
      await client.$transaction([
        client.addressLabel.deleteMany({ where: { addressId } }),
        client.addressLabel.createMany({
          data: labelIds.map(labelId => ({ addressId, labelId })),
        }),
      ]);
    },

    async removeLabelFromAddress(addressId: string, labelId: string) {
      await client.addressLabel.deleteMany({ where: { addressId, labelId } });
    },
  };
}
