/** Backpressure-safe CSV/JSON wallet transaction export route. */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { validate } from '../../../middleware/validate';
import { walletRepository, transactionRepository } from '../../../repositories';
import { asyncHandler } from '../../../errors/errorHandler';
import { ErrorCodes, RateLimitError } from '../../../errors/ApiError';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import {
  createExportRowSnapshot,
  type ExportRowSnapshot,
} from '../../../services/transactionExport/exportSnapshot';
import { transactionExportPermits } from '../../../services/transactionExport/exportPermit';
import {
  CSV_HEADERS,
  toCsvRow,
  toExportRow,
} from '../../../services/transactionExport/serialization';
import {
  ExportStreamClosedError,
  ExportOperationOwnership,
  observeExportStream,
  raceExportAbort,
  writeExportChunk,
} from '../../../services/transactionExport/streamLifecycle';

const log = createLogger('TX:EXPORT');
const EXPORT_PAGE_SIZE = 500;
const EXPORT_CAPTURE_TIMEOUT_MS = 30_000;
const EXPORT_CAPTURE_MAX_WAIT_MS = 5_000;
const EXPORT_RETRY_AFTER_SECONDS = 5;

type DateFilter = { gte?: Date; lte?: Date };

// The round trip rejects rollover inputs such as 2026-02-31 that match the
// textual shape but JavaScript would otherwise normalize into the next month.
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day;
}, 'Invalid calendar date');

const transactionExportQuerySchema = z.object({
  format: z.union([z.string(), z.array(z.string())]).optional(),
  startDate: calendarDateSchema.optional(),
  endDate: calendarDateSchema.optional(),
}).superRefine((query, context) => {
  if (query.startDate && query.endDate && query.startDate > query.endDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'End date must be on or after start date',
    });
  }
});

type TransactionExportQuery = z.infer<typeof transactionExportQuerySchema>;

function getDateFilter(query: TransactionExportQuery): DateFilter | undefined {
  const dateFilter: DateFilter = {};
  if (query.startDate) dateFilter.gte = new Date(`${query.startDate}T00:00:00.000Z`);
  // Application timestamps originate as millisecond-precision JavaScript dates.
  if (query.endDate) dateFilter.lte = new Date(`${query.endDate}T23:59:59.999Z`);
  return Object.keys(dateFilter).length > 0 ? dateFilter : undefined;
}

async function captureExportRows(
  walletId: string,
  dateFilter: DateFilter | undefined,
  requestSignal: AbortSignal,
  ownership: ExportOperationOwnership,
): Promise<ExportRowSnapshot> {
  const snapshot = await createExportRowSnapshot();
  const timeoutSignal = AbortSignal.timeout(EXPORT_CAPTURE_TIMEOUT_MS);
  const signal = AbortSignal.any([requestSignal, timeoutSignal]);

  try {
    const capture = transactionRepository.withExportCaptureTransaction(async tx => {
      let offset = 0;
      while (true) {
        signal.throwIfAborted();
        const page = await raceExportAbort(signal, ownership.hold(transactionRepository.findExportRowPage(
          walletId,
          dateFilter,
          offset,
          EXPORT_PAGE_SIZE,
          tx,
        )));
        signal.throwIfAborted();
        await raceExportAbort(signal, ownership.hold(
          snapshot.append(page.map(toExportRow), signal),
        ));
        if (page.length < EXPORT_PAGE_SIZE) break;
        offset += page.length;
      }
    }, {
      maxWait: EXPORT_CAPTURE_MAX_WAIT_MS,
      timeout: EXPORT_CAPTURE_TIMEOUT_MS,
    });
    await raceExportAbort(signal, ownership.hold(capture));
    await raceExportAbort(signal, ownership.hold(snapshot.seal(signal)));
    return snapshot;
  } catch (error) {
    const cleanup = ownership.hold(snapshot.cleanup());
    if (!signal.aborted) await cleanup;
    throw error;
  }
}

async function streamJson(
  req: Request,
  res: Response,
  snapshot: ExportRowSnapshot,
  signal: AbortSignal,
): Promise<void> {
  await writeExportChunk(req, res, '[', signal);
  let first = true;
  for await (const rows of snapshot.pages(EXPORT_PAGE_SIZE)) {
    signal.throwIfAborted();
    for (const row of rows) {
      const prefix = first ? '' : ',';
      await writeExportChunk(req, res, prefix + JSON.stringify(row), signal);
      first = false;
    }
  }
  await writeExportChunk(req, res, ']', signal);
}

async function streamCsv(
  req: Request,
  res: Response,
  snapshot: ExportRowSnapshot,
  signal: AbortSignal,
): Promise<void> {
  await writeExportChunk(req, res, `${CSV_HEADERS.join(',')}\n`, signal);
  for await (const rows of snapshot.pages(EXPORT_PAGE_SIZE)) {
    signal.throwIfAborted();
    for (const row of rows) {
      await writeExportChunk(req, res, `${toCsvRow(row)}\n`, signal);
    }
  }
}

function setExportHeaders(res: Response, walletName: string | null | undefined, isJson: boolean): void {
  const safeWalletName = walletName?.replace(/[^a-zA-Z0-9]/g, '_') || 'wallet';
  const timestamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', isJson ? 'application/json' : 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeWalletName}_transactions_${timestamp}.${isJson ? 'json' : 'csv'}"`,
  );
}

function rejectSaturatedExport(res: Response): void {
  const error = new RateLimitError(
    'Too many transaction exports are already running. Retry shortly.',
    EXPORT_RETRY_AFTER_SECONDS,
  );
  res.setHeader('Retry-After', String(EXPORT_RETRY_AFTER_SECONDS));
  res.status(error.statusCode).json(error.toResponse());
}

export function createExportRouter(): Router {
  const router = Router();

  router.get(
    '/wallets/:walletId/transactions/export',
    requireWalletAccess('view'),
    validate(
      { query: transactionExportQuerySchema },
      { message: 'Invalid transaction export query', code: ErrorCodes.INVALID_INPUT },
    ),
    asyncHandler(async (req, res) => {
    const release = transactionExportPermits.tryAcquire();
    if (!release) {
      rejectSaturatedExport(res);
      return;
    }

    const lifecycle = observeExportStream(req, res);
    const ownership = new ExportOperationOwnership();
    let snapshot: ExportRowSnapshot | null = null;
    try {
      const walletId = req.walletId!;
      const wallet = await walletRepository.findByIdWithSelect(walletId, { name: true });
      const query = req.query as TransactionExportQuery;
      snapshot = await captureExportRows(walletId, getDateFilter(query), lifecycle.signal, ownership);
      const isJson = typeof query.format === 'string' && query.format === 'json';
      setExportHeaders(res, wallet?.name, isJson);
      if (isJson) await streamJson(req, res, snapshot, lifecycle.signal);
      else await streamCsv(req, res, snapshot, lifecycle.signal);
      res.end();
    } catch (error) {
      /* v8 ignore next -- socket-close timing is covered deterministically by streamLifecycle tests */
      if (res.writableEnded || error instanceof ExportStreamClosedError || res.destroyed) {
        /* v8 ignore next -- debug side effect has no observable route contract */
        log.debug('Transaction export stream closed or response already completed');
      } else if (!res.headersSent) {
        throw error;
      } else {
        log.error('Transaction export stream failed mid-stream', { error: getErrorMessage(error) });
        /* v8 ignore next -- Express marks destroyed sockets before this fallback in HTTP tests */
        if (!res.destroyed) res.destroy(error instanceof Error ? error : new Error('export stream failed'));
      }
    } finally {
      lifecycle.dispose();
      await snapshot?.cleanup();
      ownership.releaseWhenSettled(release);
    }
    }),
  );

  return router;
}
