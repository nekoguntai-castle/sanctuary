import type { Express } from 'express';
import { createTestWallet } from '../../setup/helpers';
import type { PrismaClient } from '../../../../src/generated/prisma/client';

export let app: Express;
export let prisma: PrismaClient;

let txidCounter = 0;

export function setTransactionIntegrationContext(
  nextApp: Express,
  nextPrisma: PrismaClient
): void {
  app = nextApp;
  prisma = nextPrisma;
  txidCounter = 0;
}

export function uniqueTxid(prefix: string): string {
  const prefixHex = Array.from(prefix)
    .map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  const counterHex = (txidCounter++).toString(16).padStart(4, '0');
  const randomHex = Array.from({ length: 4 }, () => Math.random().toString(16).slice(2)).join('');
  const base = `${prefixHex}${counterHex}${randomHex}`;
  return base.padEnd(64, '0').substring(0, 64);
}

export async function createWalletWithData(
  testApp: Express,
  token: string,
  userId: string
): Promise<string> {
  void userId;

  const { id: walletId } = await createTestWallet(testApp, token);

  const txid1 = uniqueTxid('tx1');
  const txid2 = uniqueTxid('tx2');
  const txid3 = uniqueTxid('tx3');
  const txid4 = uniqueTxid('tx4');
  const utxoTxid1 = uniqueTxid('ut1');
  const utxoTxid2 = uniqueTxid('ut2');
  const utxoTxid3 = uniqueTxid('ut3');

  await prisma.transaction.createMany({
    data: [
      {
        txid: txid1,
        walletId,
        type: 'received',
        amount: BigInt(100000),
        fee: BigInt(0),
        confirmations: 6,
        blockHeight: 799994,
        blockTime: new Date('2024-01-01'),
      },
      {
        txid: txid2,
        walletId,
        type: 'received',
        amount: BigInt(50000),
        fee: BigInt(0),
        confirmations: 3,
        blockHeight: 799997,
        blockTime: new Date('2024-01-02'),
      },
      {
        txid: txid3,
        walletId,
        type: 'sent',
        amount: BigInt(-30000),
        fee: BigInt(500),
        confirmations: 1,
        blockHeight: 799999,
        blockTime: new Date('2024-01-03'),
      },
      {
        txid: txid4,
        walletId,
        type: 'received',
        amount: BigInt(20000),
        fee: BigInt(0),
        confirmations: 0,
        blockHeight: null,
        blockTime: null,
      },
    ],
  });

  const address = await prisma.address.findFirst({
    where: { walletId },
  });

  await prisma.uTXO.createMany({
    data: [
      {
        txid: utxoTxid1,
        vout: 0,
        walletId,
        address: address?.address || 'tb1qtest1',
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        confirmations: 6,
        spent: false,
        frozen: false,
      },
      {
        txid: utxoTxid2,
        vout: 0,
        walletId,
        address: address?.address || 'tb1qtest2',
        amount: BigInt(30000),
        scriptPubKey: '0014' + 'b'.repeat(40),
        confirmations: 3,
        spent: false,
        frozen: false,
      },
      {
        txid: utxoTxid3,
        vout: 1,
        walletId,
        address: address?.address || 'tb1qtest3',
        amount: BigInt(20000),
        scriptPubKey: '0014' + 'c'.repeat(40),
        confirmations: 1,
        spent: false,
        frozen: true,
      },
    ],
  });

  return walletId;
}
