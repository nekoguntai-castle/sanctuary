import { PrismaClient } from '../../../../src/generated/prisma/client';
import * as bcrypt from 'bcryptjs';

let txCounter = 0;
let deviceCounter = 0;
let utxoCounter = 0;
let addressCounter = 0;

export interface CreateUserOptions {
  username?: string;
  password?: string;
  email?: string;
  isAdmin?: boolean;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
}

export async function createTestUser(
  tx: PrismaClient,
  options: CreateUserOptions = {}
) {
  const hashedPassword = await bcrypt.hash(options.password || 'testpassword', 10);

  return tx.user.create({
    data: {
      username: options.username || `testuser-${Date.now()}`,
      password: hashedPassword,
      email: options.email || `test-${Date.now()}@example.com`,
      emailVerified: true,
      isAdmin: options.isAdmin ?? false,
      twoFactorEnabled: options.twoFactorEnabled ?? false,
      twoFactorSecret: options.twoFactorSecret,
    },
  });
}

export interface CreateGroupOptions {
  name?: string;
  description?: string;
}

export async function createTestGroup(
  tx: PrismaClient,
  options: CreateGroupOptions = {}
) {
  return tx.group.create({
    data: {
      name: options.name || `test-group-${Date.now()}`,
      description: options.description,
    },
  });
}

export async function addUserToGroup(
  tx: PrismaClient,
  userId: string,
  groupId: string,
  role: string = 'member'
) {
  return tx.groupMember.create({
    data: {
      userId,
      groupId,
      role,
    },
  });
}

export interface CreateWalletOptions {
  name?: string;
  type?: 'single_sig' | 'multi_sig';
  scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  network?: 'mainnet' | 'testnet' | 'signet' | 'regtest';
  descriptor?: string;
  fingerprint?: string;
  quorum?: number;
  totalSigners?: number;
  groupId?: string;
}

export async function createTestWallet(
  tx: PrismaClient,
  userId: string,
  options: CreateWalletOptions = {}
) {
  const wallet = await tx.wallet.create({
    data: {
      name: options.name || `test-wallet-${Date.now()}`,
      type: options.type || 'single_sig',
      scriptType: options.scriptType || 'native_segwit',
      network: options.network || 'testnet',
      descriptor: options.descriptor,
      fingerprint: options.fingerprint || `fp${Date.now().toString(16)}`,
      quorum: options.quorum,
      totalSigners: options.totalSigners,
      groupId: options.groupId,
    },
  });

  await tx.walletUser.create({
    data: {
      walletId: wallet.id,
      userId,
      role: 'owner',
    },
  });

  return wallet;
}

export interface CreateDeviceOptions {
  type?: string;
  label?: string;
  fingerprint?: string;
  xpub?: string;
  derivationPath?: string;
}

export async function createTestDevice(
  tx: PrismaClient,
  userId: string,
  options: CreateDeviceOptions = {}
) {
  const counter = ++deviceCounter;
  return tx.device.create({
    data: {
      userId,
      type: options.type || 'trezor',
      label: options.label || `test-device-${Date.now()}-${counter}`,
      fingerprint: options.fingerprint || `fp${Date.now().toString(16)}${counter.toString(16).padStart(4, '0')}`,
      xpub: options.xpub || 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
      derivationPath: options.derivationPath || "m/84'/1'/0'",
    },
  });
}

export interface CreateAddressOptions {
  address?: string;
  derivationPath?: string;
  index?: number;
  used?: boolean;
}

export async function createTestAddress(
  tx: PrismaClient,
  walletId: string,
  options: CreateAddressOptions = {}
) {
  const counter = ++addressCounter;
  return tx.address.create({
    data: {
      walletId,
      address: options.address || `tb1q${Date.now().toString(16)}${counter.toString(16).padStart(6, '0')}`.padEnd(42, '0'),
      derivationPath: options.derivationPath || `m/84'/1'/0'/0/${options.index ?? counter}`,
      index: options.index ?? counter,
      used: options.used ?? false,
    },
  });
}

export interface CreateTransactionOptions {
  txid?: string;
  type?: 'sent' | 'received' | 'consolidation';
  amount?: bigint;
  fee?: bigint;
  confirmations?: number;
  blockHeight?: number | null;
  blockTime?: Date;
  label?: string | null;
  memo?: string | null;
  rbfStatus?: 'active' | 'replaced' | 'confirmed';
}

export async function createTestTransaction(
  tx: PrismaClient,
  walletId: string,
  options: CreateTransactionOptions = {}
) {
  const uniqueTxid = options.txid || `${Date.now().toString(16)}${(++txCounter).toString(16).padStart(8, '0')}`.padEnd(64, 'a');
  return tx.transaction.create({
    data: {
      walletId,
      txid: uniqueTxid,
      type: options.type || 'received',
      amount: options.amount ?? BigInt(100000),
      fee: options.fee ?? BigInt(1000),
      confirmations: options.confirmations ?? 6,
      blockHeight: options.blockHeight ?? 100000,
      blockTime: options.blockTime ?? new Date(),
      label: options.label,
      memo: options.memo,
      rbfStatus: options.rbfStatus ?? 'active',
    },
  });
}

export interface CreateUtxoOptions {
  txid?: string;
  vout?: number;
  address?: string;
  amount?: bigint;
  scriptPubKey?: string;
  confirmations?: number;
  blockHeight?: number | null;
  spent?: boolean;
  spentTxid?: string;
  frozen?: boolean;
}

export async function createTestUtxo(
  tx: PrismaClient,
  walletId: string,
  options: CreateUtxoOptions = {}
) {
  const counter = ++utxoCounter;
  const uniqueTxid = options.txid || `${Date.now().toString(16)}${counter.toString(16).padStart(8, '0')}`.padEnd(64, 'b');
  return tx.uTXO.create({
    data: {
      walletId,
      txid: uniqueTxid,
      vout: options.vout ?? 0,
      address: options.address || `tb1q${Date.now().toString(16)}${counter.toString(16).padStart(4, '0')}`.padEnd(42, '0'),
      amount: options.amount ?? BigInt(100000),
      scriptPubKey: options.scriptPubKey || '0014751e76e8199196d454941c45d1b3a323f1433bd6',
      confirmations: options.confirmations ?? 6,
      blockHeight: 'blockHeight' in options ? options.blockHeight : 100000,
      spent: options.spent ?? false,
      spentTxid: options.spentTxid,
      frozen: options.frozen ?? false,
    },
  });
}

export interface CreateLabelOptions {
  name?: string;
  color?: string;
  description?: string;
}

export async function createTestLabel(
  tx: PrismaClient,
  walletId: string,
  options: CreateLabelOptions = {}
) {
  return tx.label.create({
    data: {
      walletId,
      name: options.name || `label-${Date.now()}`,
      color: options.color || '#6366f1',
      description: options.description,
    },
  });
}

export interface CreateDraftOptions {
  recipient?: string;
  amount?: bigint;
  feeRate?: number;
  psbtBase64?: string;
  fee?: bigint;
  status?: 'unsigned' | 'partial' | 'signed';
  createdAt?: Date;
}

export async function createTestDraft(
  tx: PrismaClient,
  walletId: string,
  userId: string,
  options: CreateDraftOptions = {}
) {
  return tx.draftTransaction.create({
    data: {
      walletId,
      userId,
      recipient: options.recipient || 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      amount: options.amount ?? BigInt(50000),
      feeRate: options.feeRate ?? 10,
      selectedUtxoIds: [],
      psbtBase64: options.psbtBase64 || 'cHNidP8BAHUCAAAAAQLdKnlX',
      fee: options.fee ?? BigInt(1000),
      totalInput: BigInt(100000),
      totalOutput: BigInt(99000),
      changeAmount: BigInt(49000),
      effectiveAmount: BigInt(50000),
      inputPaths: [],
      status: options.status ?? 'unsigned',
      createdAt: options.createdAt,
    },
  });
}

export interface CreateAuditLogOptions {
  action?: string;
  category?: string;
  details?: Record<string, unknown> | null;
  success?: boolean;
  errorMsg?: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function createTestAuditLog(
  tx: PrismaClient,
  userId: string | null,
  username: string,
  options: CreateAuditLogOptions = {}
) {
  return tx.auditLog.create({
    data: {
      userId,
      username,
      action: options.action || 'test.action',
      category: options.category || 'system',
      details: options.details as any,
      success: options.success ?? true,
      errorMsg: options.errorMsg,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    },
  });
}

export interface CreateSessionOptions {
  token?: string;
  expiresAt?: Date;
  lastUsedAt?: Date;
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

export async function createTestSession(
  tx: PrismaClient,
  userId: string,
  options: CreateSessionOptions = {}
) {
  const crypto = await import('crypto');
  const token = options.token || crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  return tx.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lastUsedAt: options.lastUsedAt,
      deviceId: options.deviceId,
      deviceName: options.deviceName,
      userAgent: options.userAgent,
      ipAddress: options.ipAddress,
    },
  });
}

export interface CreatePushDeviceOptions {
  token?: string;
  platform?: 'ios' | 'android';
  deviceName?: string;
  lastUsedAt?: Date;
  createdAt?: Date;
}

export async function createTestPushDevice(
  tx: PrismaClient,
  userId: string,
  options: CreatePushDeviceOptions = {}
) {
  return tx.pushDevice.create({
    data: {
      userId,
      token: options.token || `push-token-${Date.now()}`,
      platform: options.platform || 'ios',
      deviceName: options.deviceName,
      lastUsedAt: options.lastUsedAt,
      createdAt: options.createdAt,
    },
  });
}
