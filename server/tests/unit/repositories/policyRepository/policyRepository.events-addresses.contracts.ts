import { prisma, type Mock } from './policyRepositoryTestHarness';
import { describe, expect, it } from 'vitest';
import {
  createPolicyEvent,
  findPolicyEvents,
  findPolicyAddresses,
  createPolicyAddress,
  removePolicyAddress,
  findPolicyAddressByAddress,
  findPolicyAddressById,
} from '../../../../src/repositories/policyRepository';

export const registerPolicyRepositoryEventAddressContracts = () => {
  describe('createPolicyEvent', () => {
    it('creates an event with defaults for optional fields', async () => {
      const created = { id: 'event-1' };
      (prisma.policyEvent.create as Mock).mockResolvedValue(created);

      const result = await createPolicyEvent({
        walletId: 'wallet-1',
        eventType: 'policy_triggered',
        details: { reason: 'spending_limit exceeded' },
      });

      expect(result).toEqual(created);
      expect(prisma.policyEvent.create).toHaveBeenCalledWith({
        data: {
          policyId: null,
          walletId: 'wallet-1',
          draftTransactionId: null,
          userId: null,
          eventType: 'policy_triggered',
          details: { reason: 'spending_limit exceeded' },
        },
      });
    });

    it('creates an event with all optional fields provided', async () => {
      const created = { id: 'event-2' };
      (prisma.policyEvent.create as Mock).mockResolvedValue(created);

      const result = await createPolicyEvent({
        policyId: 'policy-1',
        walletId: 'wallet-1',
        draftTransactionId: 'draft-1',
        userId: 'user-1',
        eventType: 'approval_granted',
        details: { votes: 2 },
      });

      expect(result).toEqual(created);
      expect(prisma.policyEvent.create).toHaveBeenCalledWith({
        data: {
          policyId: 'policy-1',
          walletId: 'wallet-1',
          draftTransactionId: 'draft-1',
          userId: 'user-1',
          eventType: 'approval_granted',
          details: { votes: 2 },
        },
      });
    });
  });

  describe('findPolicyEvents', () => {
    it('queries events with default limit and offset when no options provided', async () => {
      const events = [{ id: 'ev1' }];
      (prisma.policyEvent.findMany as Mock).mockResolvedValue(events);
      (prisma.policyEvent.count as Mock).mockResolvedValue(1);

      const result = await findPolicyEvents('wallet-1');

      expect(result).toEqual({ events, total: 1 });
      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
      expect(prisma.policyEvent.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
      });
    });

    it('includes policyId filter when provided', async () => {
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { policyId: 'policy-1' });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', policyId: 'policy-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('includes eventType filter when provided', async () => {
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { eventType: 'policy_triggered' });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', eventType: 'policy_triggered' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('includes date range filter with both from and to', async () => {
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-12-31T23:59:59Z');
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { from, to });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-1',
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('includes date range filter with only from', async () => {
      const from = new Date('2026-01-01T00:00:00Z');
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { from });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-1',
          createdAt: { gte: from },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('includes date range filter with only to', async () => {
      const to = new Date('2026-12-31T23:59:59Z');
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', { to });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-1',
          createdAt: { lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('uses custom limit and offset', async () => {
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(100);

      const result = await findPolicyEvents('wallet-1', { limit: 10, offset: 20 });

      expect(result).toEqual({ events: [], total: 100 });
      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 20,
      });
    });

    it('combines all filters together', async () => {
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-06-01T00:00:00Z');
      (prisma.policyEvent.findMany as Mock).mockResolvedValue([]);
      (prisma.policyEvent.count as Mock).mockResolvedValue(0);

      await findPolicyEvents('wallet-1', {
        policyId: 'policy-1',
        eventType: 'blocked',
        from,
        to,
        limit: 5,
        offset: 10,
      });

      expect(prisma.policyEvent.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-1',
          policyId: 'policy-1',
          eventType: 'blocked',
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        skip: 10,
      });
    });
  });

  // ========================================
  // POLICY ADDRESSES
  // ========================================

  describe('findPolicyAddresses', () => {
    it('finds addresses for a policy without listType filter', async () => {
      const addresses = [{ id: 'addr-1' }];
      (prisma.policyAddress.findMany as Mock).mockResolvedValue(addresses);

      const result = await findPolicyAddresses('policy-1');

      expect(result).toEqual(addresses);
      expect(prisma.policyAddress.findMany).toHaveBeenCalledWith({
        where: { policyId: 'policy-1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('finds addresses for a policy with listType filter', async () => {
      const addresses = [{ id: 'addr-1', listType: 'allow' }];
      (prisma.policyAddress.findMany as Mock).mockResolvedValue(addresses);

      const result = await findPolicyAddresses('policy-1', 'allow');

      expect(result).toEqual(addresses);
      expect(prisma.policyAddress.findMany).toHaveBeenCalledWith({
        where: { policyId: 'policy-1', listType: 'allow' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('createPolicyAddress', () => {
    it('creates a policy address with defaults', async () => {
      const created = { id: 'pa-1' };
      (prisma.policyAddress.create as Mock).mockResolvedValue(created);

      const result = await createPolicyAddress({
        policyId: 'policy-1',
        address: 'bc1qtest',
        listType: 'allow',
        addedBy: 'user-1',
      });

      expect(result).toEqual(created);
      expect(prisma.policyAddress.create).toHaveBeenCalledWith({
        data: {
          policyId: 'policy-1',
          address: 'bc1qtest',
          label: null,
          listType: 'allow',
          addedBy: 'user-1',
        },
      });
    });

    it('creates a policy address with label', async () => {
      const created = { id: 'pa-2' };
      (prisma.policyAddress.create as Mock).mockResolvedValue(created);

      const result = await createPolicyAddress({
        policyId: 'policy-1',
        address: 'bc1qlabeled',
        label: 'Exchange withdrawal',
        listType: 'deny',
        addedBy: 'user-2',
      });

      expect(result).toEqual(created);
      expect(prisma.policyAddress.create).toHaveBeenCalledWith({
        data: {
          policyId: 'policy-1',
          address: 'bc1qlabeled',
          label: 'Exchange withdrawal',
          listType: 'deny',
          addedBy: 'user-2',
        },
      });
    });
  });

  describe('removePolicyAddress', () => {
    it('deletes a policy address by id', async () => {
      (prisma.policyAddress.delete as Mock).mockResolvedValue(undefined);

      await removePolicyAddress('pa-1');

      expect(prisma.policyAddress.delete).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
      });
    });
  });

  describe('findPolicyAddressByAddress', () => {
    it('finds a policy address by composite key', async () => {
      const address = { id: 'pa-1', address: 'bc1qtest' };
      (prisma.policyAddress.findUnique as Mock).mockResolvedValue(address);

      const result = await findPolicyAddressByAddress('policy-1', 'bc1qtest');

      expect(result).toEqual(address);
      expect(prisma.policyAddress.findUnique).toHaveBeenCalledWith({
        where: {
          policyId_address: {
            policyId: 'policy-1',
            address: 'bc1qtest',
          },
        },
      });
    });

    it('returns null when address not found', async () => {
      (prisma.policyAddress.findUnique as Mock).mockResolvedValue(null);

      const result = await findPolicyAddressByAddress('policy-1', 'bc1qmissing');

      expect(result).toBeNull();
    });
  });

  describe('findPolicyAddressById', () => {
    it('finds a policy address by id', async () => {
      const address = { id: 'pa-1' };
      (prisma.policyAddress.findUnique as Mock).mockResolvedValue(address);

      const result = await findPolicyAddressById('pa-1');

      expect(result).toEqual(address);
      expect(prisma.policyAddress.findUnique).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
      });
    });

    it('returns null when not found', async () => {
      (prisma.policyAddress.findUnique as Mock).mockResolvedValue(null);

      const result = await findPolicyAddressById('nonexistent');

      expect(result).toBeNull();
    });
  });
};
