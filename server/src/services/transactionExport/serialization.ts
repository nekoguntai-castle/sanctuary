import type { ExportTransactionRow } from '../../repositories/transactionRepository';

export interface ExportRow {
  date: string;
  txid: string;
  type: string;
  amountBtc: number;
  amountSats: number;
  balanceAfterBtc: number | null;
  balanceAfterSats: number | null;
  feeSats: number | null;
  confirmations: number;
  label: string;
  memo: string;
  counterpartyAddress: string;
  blockHeight: number | null;
}

export const CSV_HEADERS = [
  'Date',
  'Transaction ID',
  'Type',
  'Amount (BTC)',
  'Amount (sats)',
  'Balance After (BTC)',
  'Balance After (sats)',
  'Fee (sats)',
  'Confirmations',
  'Label',
  'Memo',
  'Counterparty Address',
  'Block Height',
];

const DANGEROUS_CSV_PREFIX = /^[=+\-@\t\r]/;

export function toExportRow(tx: ExportTransactionRow): ExportRow {
  const signedAmount = Number(tx.amount);
  return {
    date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
    txid: tx.txid,
    type: tx.type,
    amountBtc: signedAmount / 100_000_000,
    amountSats: signedAmount,
    balanceAfterBtc: tx.balanceAfter == null ? null : Number(tx.balanceAfter) / 100_000_000,
    balanceAfterSats: tx.balanceAfter == null ? null : Number(tx.balanceAfter),
    feeSats: tx.fee == null ? null : Number(tx.fee),
    confirmations: tx.confirmations,
    label: tx.label || '',
    memo: tx.memo || '',
    counterpartyAddress: tx.counterpartyAddress || '',
    blockHeight: tx.blockHeight == null ? null : Number(tx.blockHeight),
  };
}

function neutralizeCsvFormula(value: string): string {
  return DANGEROUS_CSV_PREFIX.test(value) ? `'${value}` : value;
}

export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? neutralizeCsvFormula(value) : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvRow(row: ExportRow): string {
  return [
    row.date,
    row.txid,
    row.type,
    row.amountBtc,
    row.amountSats,
    row.balanceAfterBtc,
    row.balanceAfterSats,
    row.feeSats,
    row.confirmations,
    row.label,
    row.memo,
    row.counterpartyAddress,
    row.blockHeight,
  ].map(escapeCsv).join(',');
}
