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

/**
 * Upper bound on total export duration. Large wallets (>100k tx) stream
 * in chunks over a single interactive transaction, so we need to leave
 * enough headroom for the slowest path: page read + serialize + wire
 * write × N, plus client-side backpressure. Five minutes is generous
 * relative to observed p99 and well under the default idle timeout.
 */
const EXPORT_TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How long to wait for a free connection from the pool before giving up.
 */
const EXPORT_TRANSACTION_MAX_WAIT_MS = 10 * 1000;

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

    const walletName = wallet?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'wallet';
    const timestamp = new Date().toISOString().slice(0, 10);
    const isJson = format === 'json';

    // Track whether headers have been flushed. Before headers, errors
    // propagate to the errorHandler (→ 500/INTERNAL_ERROR). After headers,
    // the response is committed to 200 and we can only destroy the socket.
    let headersSent = false;

    try {
      // Wrap the entire paged read in a single interactive transaction
      // with REPEATABLE READ isolation. PostgreSQL MVCC gives this
      // transaction a consistent snapshot at the first statement, so
      // concurrent wallet sync inserts/deletes between page reads cannot
      // shift the `skip` offset and cause duplicated or missed rows.
      // Without this, skip-based pagination is not snapshot-safe under
      // concurrent writes.
      await transactionRepository.withRepeatableReadTransaction(
        async (tx) => {
          // First page is fetched inside the transaction. A DB error here
          // propagates out of $transaction and is caught by the outer
          // try/catch — headersSent is still false so the errorHandler
          // receives it cleanly.
          let page = await transactionRepository.findExportPage(
            walletId,
            activeFilter,
            0,
            EXPORT_PAGE_SIZE,
            tx,
          );

          res.setHeader('Content-Type', isJson ? 'application/json' : 'text/csv');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${walletName}_transactions_${timestamp}.${isJson ? 'json' : 'csv'}"`,
          );
          headersSent = true;

          if (isJson) {
            await writeChunk(res, '[');
            let isFirst = true;
            let offset = 0;
            while (page.length > 0) {
              for (const row of page) {
                /* v8 ignore next -- client disconnect race is covered by stream destroy handling */
                if (req.destroyed) return;
                const prefix = isFirst ? '' : ',';
                await writeChunk(res, prefix + JSON.stringify(toExportRow(row)));
                isFirst = false;
              }
              if (page.length < EXPORT_PAGE_SIZE) break;
              offset += page.length;
              page = await transactionRepository.findExportPage(
                walletId,
                activeFilter,
                offset,
                EXPORT_PAGE_SIZE,
                tx,
              );
            }
            await writeChunk(res, ']');
          } else {
            await writeChunk(res, CSV_HEADERS.join(',') + '\n');
            let offset = 0;
            while (page.length > 0) {
              for (const row of page) {
                /* v8 ignore next -- client disconnect race is covered by stream destroy handling */
                if (req.destroyed) return;
                await writeChunk(res, toCsvRow(toExportRow(row)) + '\n');
              }
              if (page.length < EXPORT_PAGE_SIZE) break;
              offset += page.length;
              page = await transactionRepository.findExportPage(
                walletId,
                activeFilter,
                offset,
                EXPORT_PAGE_SIZE,
                tx,
              );
            }
          }
          res.end();
        },
        {
          maxWait: EXPORT_TRANSACTION_MAX_WAIT_MS,
          timeout: EXPORT_TRANSACTION_TIMEOUT_MS,
        },
      );
    } catch (err) {
      if (!headersSent) {
        // Pre-header error path: let asyncHandler → errorHandler produce
        // the normal 500/INTERNAL_ERROR response.
        throw err;
      }
      // Mid-stream error path: the response is already committed to 200
      // and partial bytes are on the wire. All we can do is log and
      // forcibly terminate the socket so the client notices.
      log.error('Transaction export stream failed mid-stream', {
        walletId,
        format,
        error: getErrorMessage(err),
      });
      /* v8 ignore next 2 -- response destroy guard covers connection races after stream failures */
      if (!res.destroyed) {
        res.destroy(err instanceof Error ? err : new Error('export stream failed'));
      }
    }
  }));

  return router;
}
