/**
 * Repository Factory Interfaces
 *
 * Type definitions for the repository factory pattern.
 * Separated from factory.ts for cleaner organization.
 */

import type { PrismaClient, Wallet, Transaction, Address, UTXO, User, Label } from '@prisma/client';

// Type for the minimal Prisma client interface needed by repositories
export type PrismaClientLike = Pick<
  PrismaClient,
  'wallet' | 'transaction' | 'address' | 'uTXO' | 'user' | 'walletUser' | 'groupMember' | 'label' | 'transactionLabel' | 'addressLabel' | '$transaction'
>;

/**
 * Wallet Repository Interface
 */
export interface WalletRepositoryInterface {
  findById(walletId: string): Promise<Wallet | null>;
  findByIdWithAccess(walletId: string, userId: string): Promise<Wallet | null>;
  findByUserId(userId: string): Promise<Wallet[]>;
  hasAccess(walletId: string, userId: string): Promise<boolean>;
  getName(walletId: string): Promise<string | null>;
  update(walletId: string, data: Partial<Wallet>): Promise<Wallet>;
}

/**
 * Transaction Repository Interface
 */
export interface TransactionRepositoryInterface {
  findByWalletId(walletId: string, options?: { skip?: number; take?: number }): Promise<Transaction[]>;
  findByTxid(txid: string, walletId: string): Promise<Transaction | null>;
  countByWalletId(walletId: string): Promise<number>;
  deleteByWalletId(walletId: string): Promise<number>;
}

/**
 * Address Repository Interface
 */
export interface AddressRepositoryInterface {
  findByWalletId(walletId: string, options?: { used?: boolean }): Promise<Address[]>;
  findNextUnused(walletId: string): Promise<Address | null>;
  markAsUsed(addressId: string): Promise<Address>;
  resetUsedFlags(walletId: string): Promise<number>;
}

/**
 * UTXO Repository Interface
 */
export interface UtxoRepositoryInterface {
  findByWalletId(walletId: string, options?: { spent?: boolean }): Promise<UTXO[]>;
  findUnspent(walletId: string): Promise<UTXO[]>;
  getUnspentBalance(walletId: string): Promise<bigint>;
  deleteByWalletId(walletId: string): Promise<number>;
}

/**
 * User Repository Interface
 */
export interface UserRepositoryInterface {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  exists(id: string): Promise<boolean>;
}

/**
 * Label with usage counts
 */
export interface LabelWithCounts extends Label {
  transactionCount: number;
  addressCount: number;
}

/**
 * Label with full associations
 */
export interface LabelWithAssociations extends Label {
  transactions: Array<{
    id: string;
    txid: string;
    type: string;
    amount: bigint;
    confirmations: number;
    blockTime: Date | null;
  }>;
  addresses: Array<{
    id: string;
    address: string;
    derivationPath: string;
    index: number;
    used: boolean;
  }>;
}

/**
 * Label Repository Interface
 */
export interface LabelRepositoryInterface {
  // Label CRUD
  findByWalletId(walletId: string): Promise<LabelWithCounts[]>;
  findById(labelId: string): Promise<Label | null>;
  findByIdInWallet(labelId: string, walletId: string): Promise<Label | null>;
  findByIdWithAssociations(labelId: string, walletId: string): Promise<LabelWithAssociations | null>;
  findByNameInWallet(walletId: string, name: string): Promise<Label | null>;
  isNameTakenByOther(walletId: string, name: string, excludeLabelId: string): Promise<boolean>;
  findManyByIdsInWallet(labelIds: string[], walletId: string): Promise<Label[]>;
  create(data: { walletId: string; name: string; color?: string; description?: string | null }): Promise<Label>;
  update(labelId: string, data: { name?: string; color?: string; description?: string | null }): Promise<Label>;
  remove(labelId: string): Promise<void>;
  // Transaction label operations
  getLabelsForTransaction(transactionId: string): Promise<Label[]>;
  addLabelsToTransaction(transactionId: string, labelIds: string[]): Promise<void>;
  replaceTransactionLabels(transactionId: string, labelIds: string[]): Promise<void>;
  removeLabelFromTransaction(transactionId: string, labelId: string): Promise<void>;
  // Address label operations
  getLabelsForAddress(addressId: string): Promise<Label[]>;
  addLabelsToAddress(addressId: string, labelIds: string[]): Promise<void>;
  replaceAddressLabels(addressId: string, labelIds: string[]): Promise<void>;
  removeLabelFromAddress(addressId: string, labelId: string): Promise<void>;
}

/**
 * Combined Repository Interface
 */
export interface RepositoryFactory {
  wallet: WalletRepositoryInterface;
  transaction: TransactionRepositoryInterface;
  address: AddressRepositoryInterface;
  utxo: UtxoRepositoryInterface;
  user: UserRepositoryInterface;
  label: LabelRepositoryInterface;
}
