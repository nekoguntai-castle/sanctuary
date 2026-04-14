/**
 * Wallet Transactions - Export Route
 *
 * Streams wallet transactions to the client as CSV or JSON. Pages through
 * the repository to keep server memory bounded regardless of wallet size.
 */

import { Router, type Response } from 'express';
import { once } from 'node:events';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { walletRepository, transactionRepository } from '../../../repositories';
import type { ExportTransactionRow } from '../../../repositories/transactionRepository';
import { asyncHandler } from '../../../errors/errorHandler';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';

const log = createLogger('TX:EXPORT');

/**
 * Rows per database fetch. 500 keeps peak memory low while amortizing
 * query overhead; the handler still emits each row to the wire as soon
 * as it is read, so the client's download starts well before the full
 * result set is fetched.
 */
const EXPORT_PAGE_SIZE = 500;

interface ExportRow {
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

const CSV_HEADERS = [
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

function toExportRow(tx: ExportTransactionRow): ExportRow {
  // Stored amount is already correctly signed (send negative incl. fee,
  // receive positive, consolidation negative fee).
  const signedAmount = Number(tx.amount);
  return {
    date: tx.blockTime?.toISOString() || tx.createdAt.toISOString(),
    txid: tx.txid,
    type: tx.type,
    amountBtc: signedAmount / 100_000_000,
    amountSats: signedAmount,
    balanceAfterBtc: tx.balanceAfter ? Number(tx.balanceAfter) / 100_000_000 : null,
    balanceAfterSats: tx.balanceAfter ? Number(tx.balanceAfter) : null,
    feeSats: tx.fee ? Number(tx.fee) : null,
    confirmations: tx.confirmations,
    label: tx.label || '',
    memo: tx.memo || '',
    counterpartyAddress: tx.counterpartyAddress || '',
    blockHeight: tx.blockHeight ? Number(tx.blockHeight) : null,
  };
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(row: ExportRow): string {
  return [
    escapeCsv(row.date),
    escapeCsv(row.txid),
    escapeCsv(row.type),
    escapeCsv(row.amountBtc),
    escapeCsv(row.amountSats),
    escapeCsv(row.balanceAfterBtc),
    escapeCsv(row.balanceAfterSats),
    escapeCsv(row.feeSats),
    escapeCsv(row.confirmations),
    escapeCsv(row.label),
    escapeCsv(row.memo),
    escapeCsv(row.counterpartyAddress),
    escapeCsv(row.blockHeight),
  ].join(',');
}

/** Backpressure-aware chunk write. */
async function writeChunk(res: Response, chunk: string): Promise<void> {
  if (!res.write(chunk)) {
    await once(res, 'drain');
  }
}

export function createExportRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/wallets/:walletId/transactions/export
   * Stream wallet transactions in CSV (default) or JSON format.
   */
  router.get('/wallets/:walletId/transactions/export', requireWalletAccess('view'), asyncHandler(async (req, res) => {
    const walletId = req.walletId!;
    const { format = 'csv', startDate, endDate } = req.query;

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate as string);
    }
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    const activeFilter = Object.keys(dateFilter).length > 0 ? dateFilter : undefined;

    // Wallet lookup — a throw here flows through the normal errorHandler
    // because nothing has been written to the response yet.
    const wallet = await walletRepository.findByIdWithSelect(walletId, { name: true });

    // Fetch the first page eagerly so that a DB error on the very first
    // call still results in a clean 500/INTERNAL_ERROR response (preserves
    // the pre-streaming error contract).
    let page = await transactionRepository.findExportPage(walletId, activeFilter, 0, EXPORT_PAGE_SIZE);

    const walletName = wallet?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'wallet';
    const timestamp = new Date().toISOString().slice(0, 10);
    const isJson = format === 'json';

    res.setHeader('Content-Type', isJson ? 'application/json' : 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${walletName}_transactions_${timestamp}.${isJson ? 'json' : 'csv'}"`,
    );

    // Committed to a 200 response from here on. Any error must end the
    // stream (by destroying the socket) rather than trying to change
    // status — the client has already seen headers.
    try {
      if (isJson) {
        await writeChunk(res, '[');
        let isFirst = true;
        let offset = 0;
        while (page.length > 0) {
          for (const tx of page) {
            if (req.destroyed) return;
            const prefix = isFirst ? '' : ',';
            await writeChunk(res, prefix + JSON.stringify(toExportRow(tx)));
            isFirst = false;
          }
          if (page.length < EXPORT_PAGE_SIZE) break;
          offset += page.length;
          page = await transactionRepository.findExportPage(walletId, activeFilter, offset, EXPORT_PAGE_SIZE);
        }
        await writeChunk(res, ']');
      } else {
        await writeChunk(res, CSV_HEADERS.join(',') + '\n');
        let offset = 0;
        while (page.length > 0) {
          for (const tx of page) {
            if (req.destroyed) return;
            await writeChunk(res, toCsvRow(toExportRow(tx)) + '\n');
          }
          if (page.length < EXPORT_PAGE_SIZE) break;
          offset += page.length;
          page = await transactionRepository.findExportPage(walletId, activeFilter, offset, EXPORT_PAGE_SIZE);
        }
      }
      res.end();
    } catch (err) {
      log.error('Transaction export stream failed mid-stream', {
        walletId,
        format,
        error: getErrorMessage(err),
      });
      if (!res.destroyed) {
        res.destroy(err instanceof Error ? err : new Error('export stream failed'));
      }
    }
  }));

  return router;
}
