import { mockPrismaClient } from "../../../mocks/prisma";
import { sampleUtxos, testnetAddresses } from "../../../fixtures/bitcoin";

type AddressMockRow = {
  id?: string;
  address: string;
  derivationPath: string;
  walletId?: string;
  used?: boolean;
  index?: number;
  [key: string]: unknown;
};

type AddressFindManyQuery = {
  where?: {
    walletId?: string;
    used?: boolean;
    address?: {
      in?: string[];
      notIn?: string[];
    };
  };
  take?: number;
};

type AddressFindManyMockOptions = {
  inputRows?: AddressMockRow[];
  unusedRows?: AddressMockRow[];
};

export function inputAddressRow(
  walletId: string,
  index = 0,
  overrides: Partial<AddressMockRow> = {},
): AddressMockRow {
  return {
    id: `input-addr-${index}`,
    address: sampleUtxos[index]?.address ?? sampleUtxos[0].address,
    derivationPath: `m/84'/1'/0'/0/${index}`,
    walletId,
    index,
    ...overrides,
  };
}

export function changeAddressRow(
  walletId: string,
  index = 0,
  overrides: Partial<AddressMockRow> = {},
): AddressMockRow {
  return {
    id: `change-addr-${index}`,
    address: testnetAddresses.nativeSegwit[1],
    derivationPath: `m/84'/1'/0'/1/${index}`,
    walletId,
    used: false,
    index,
    ...overrides,
  };
}

export function receiveAddressRow(
  walletId: string,
  index = 0,
  overrides: Partial<AddressMockRow> = {},
): AddressMockRow {
  return {
    id: `receive-addr-${index}`,
    address: testnetAddresses.legacy[1],
    derivationPath: `m/84'/1'/0'/0/${index}`,
    walletId,
    used: false,
    index,
    ...overrides,
  };
}

function selectAddressRows(
  query: AddressFindManyQuery,
  inputRows: AddressMockRow[],
  unusedRows: AddressMockRow[],
): AddressMockRow[] {
  const where = query.where ?? {};
  const addressFilter = where.address;
  const rows = addressFilter?.in
    ? inputRows
    : where.used === false
      ? unusedRows
      : [...inputRows, ...unusedRows];

  return rows.filter((row) => matchesWhere(row, where));
}

function matchesWhere(
  row: AddressMockRow,
  where: NonNullable<AddressFindManyQuery["where"]>,
): boolean {
  if (where.walletId && row.walletId && row.walletId !== where.walletId) {
    return false;
  }

  if (
    where.used !== undefined &&
    row.used !== undefined &&
    row.used !== where.used
  ) {
    return false;
  }

  if (where.address?.in && !where.address.in.includes(row.address)) {
    return false;
  }

  if (where.address?.notIn?.includes(row.address)) {
    return false;
  }

  return true;
}

function limitRows(rows: AddressMockRow[], take?: number): AddressMockRow[] {
  return take === undefined ? rows : rows.slice(0, Math.max(0, take));
}

export function mockAddressFindManyByQuery(
  options: AddressFindManyMockOptions,
): void {
  const metadataRows = options.inputRows ?? [];
  const availableRows = options.unusedRows ?? [];

  mockPrismaClient.address.findMany.mockImplementation(
    (query: AddressFindManyQuery = {}) => {
      const rows = selectAddressRows(query, metadataRows, availableRows);
      return Promise.resolve(limitRows(rows, query.take));
    },
  );
}
