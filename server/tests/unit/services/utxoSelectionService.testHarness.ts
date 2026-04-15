export const WALLET_ID = 'wallet-123';
export const ADDRESS_1 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
export const ADDRESS_2 = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';
export const ADDRESS_3 = 'tb1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg';

export const createTestUtxo = (overrides: Partial<{
  id: string;
  txid: string;
  vout: number;
  address: string;
  amount: bigint;
  confirmations: number;
  blockHeight: number | null;
  frozen: boolean;
  spent: boolean;
  draftLock: null | { draftId: string };
}> = {}) => ({
  id: 'utxo-1',
  txid: 'aaaa'.repeat(16),
  vout: 0,
  address: ADDRESS_1,
  amount: BigInt(100000),
  confirmations: 6,
  blockHeight: 800000,
  frozen: false,
  spent: false,
  draftLock: null,
  ...overrides,
});
