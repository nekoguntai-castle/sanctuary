import { PrismaClient } from '../../../../src/generated/prisma/client';
import {
  createTestAddress,
  createTestDevice,
  createTestLabel,
  createTestTransaction,
  createTestUser,
  createTestUtxo,
  createTestWallet,
  type CreateAddressOptions,
  type CreateDeviceOptions,
  type CreateLabelOptions,
  type CreateTransactionOptions,
  type CreateUserOptions,
  type CreateUtxoOptions,
  type CreateWalletOptions,
} from './factories';

type TestUserEntity = Awaited<ReturnType<typeof createTestUser>>;
type TestDeviceEntity = Awaited<ReturnType<typeof createTestDevice>>;
type TestWalletEntity = Awaited<ReturnType<typeof createTestWallet>>;
type TestAddressEntity = Awaited<ReturnType<typeof createTestAddress>>;
type TestUtxoEntity = Awaited<ReturnType<typeof createTestUtxo>>;
type TestTransactionEntity = Awaited<ReturnType<typeof createTestTransaction>>;
type TestLabelEntity = Awaited<ReturnType<typeof createTestLabel>>;

export class TestScenarioBuilder {
  private tx: PrismaClient;
  private userOptions: CreateUserOptions | null = null;
  private walletOptions: CreateWalletOptions | null = null;
  private deviceOptions: CreateDeviceOptions | null = null;
  private utxoCount = 0;
  private utxoOptions: CreateUtxoOptions = {};
  private transactionCount = 0;
  private transactionOptions: CreateTransactionOptions = {};
  private addressCount = 0;
  private addressOptions: CreateAddressOptions = {};
  private labelCount = 0;
  private labelOptions: CreateLabelOptions = {};

  constructor(tx: PrismaClient) {
    this.tx = tx;
  }

  withUser(options: CreateUserOptions = {}): this {
    this.userOptions = options;
    return this;
  }

  withWallet(options: CreateWalletOptions = {}): this {
    this.walletOptions = options;
    return this;
  }

  withDevice(options: CreateDeviceOptions = {}): this {
    this.deviceOptions = options;
    return this;
  }

  withUtxos(count: number, options: CreateUtxoOptions = {}): this {
    this.utxoCount = count;
    this.utxoOptions = options;
    return this;
  }

  withTransactions(count: number, options: CreateTransactionOptions = {}): this {
    this.transactionCount = count;
    this.transactionOptions = options;
    return this;
  }

  withAddresses(count: number, options: CreateAddressOptions = {}): this {
    this.addressCount = count;
    this.addressOptions = options;
    return this;
  }

  withLabels(count: number, options: CreateLabelOptions = {}): this {
    this.labelCount = count;
    this.labelOptions = options;
    return this;
  }

  private async createRequestedDevice(user: TestUserEntity): Promise<TestDeviceEntity | null> {
    if (this.deviceOptions === null) {
      return null;
    }

    return createTestDevice(this.tx, user.id, this.deviceOptions);
  }

  private async createRequestedWallet(user: TestUserEntity): Promise<TestWalletEntity | null> {
    if (this.walletOptions === null) {
      return null;
    }

    return createTestWallet(this.tx, user.id, this.walletOptions);
  }

  private async createRequestedAddresses(wallet: TestWalletEntity | null): Promise<TestAddressEntity[]> {
    const addresses: TestAddressEntity[] = [];
    if (!wallet || this.addressCount <= 0) {
      return addresses;
    }

    for (let i = 0; i < this.addressCount; i++) {
      addresses.push(
        await createTestAddress(this.tx, wallet.id, {
          ...this.addressOptions,
          index: i,
        })
      );
    }

    return addresses;
  }

  private async createRequestedUtxos(wallet: TestWalletEntity | null): Promise<TestUtxoEntity[]> {
    const utxos: TestUtxoEntity[] = [];
    if (!wallet || this.utxoCount <= 0) {
      return utxos;
    }

    for (let i = 0; i < this.utxoCount; i++) {
      utxos.push(
        await createTestUtxo(this.tx, wallet.id, {
          ...this.utxoOptions,
          vout: i,
        })
      );
    }

    return utxos;
  }

  private async createRequestedTransactions(wallet: TestWalletEntity | null): Promise<TestTransactionEntity[]> {
    const transactions: TestTransactionEntity[] = [];
    if (!wallet || this.transactionCount <= 0) {
      return transactions;
    }

    for (let i = 0; i < this.transactionCount; i++) {
      transactions.push(
        await createTestTransaction(this.tx, wallet.id, this.transactionOptions)
      );
    }

    return transactions;
  }

  private async createRequestedLabels(wallet: TestWalletEntity | null): Promise<TestLabelEntity[]> {
    const labels: TestLabelEntity[] = [];
    if (!wallet || this.labelCount <= 0) {
      return labels;
    }

    for (let i = 0; i < this.labelCount; i++) {
      labels.push(
        await createTestLabel(this.tx, wallet.id, {
          ...this.labelOptions,
          name: `${this.labelOptions.name || 'label'}-${i}`,
        })
      );
    }

    return labels;
  }

  async build(): Promise<TestScenario> {
    const user = await createTestUser(this.tx, this.userOptions || {});
    const device = await this.createRequestedDevice(user);
    const wallet = await this.createRequestedWallet(user);

    return {
      user,
      device,
      wallet,
      addresses: await this.createRequestedAddresses(wallet),
      utxos: await this.createRequestedUtxos(wallet),
      transactions: await this.createRequestedTransactions(wallet),
      labels: await this.createRequestedLabels(wallet),
    };
  }
}

export interface TestScenario {
  user: TestUserEntity;
  device: TestDeviceEntity | null;
  wallet: TestWalletEntity | null;
  addresses: TestAddressEntity[];
  utxos: TestUtxoEntity[];
  transactions: TestTransactionEntity[];
  labels: TestLabelEntity[];
}
