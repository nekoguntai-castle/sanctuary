/**
 * Optional Prisma interactive-transaction defaults, in milliseconds.
 * Undefined values leave Prisma's built-in defaults in place.
 */
export interface PrismaTransactionTimeoutOptions {
  maxWait?: number;
  timeout?: number;
}

/**
 * Environment variables used to override Prisma interactive-transaction
 * defaults. Missing or invalid values are ignored independently.
 */
export interface PrismaTransactionTimeoutEnv {
  PRISMA_TRANSACTION_MAX_WAIT_MS?: string;
  PRISMA_TRANSACTION_TIMEOUT_MS?: string;
}

function parseOptionalPositiveIntegerMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Resolve optional Prisma interactive-transaction defaults from the environment.
 *
 * Production keeps Prisma's built-in defaults unless these values are set. CI can
 * raise them for slow shared runners without changing service code paths or
 * masking tests by skipping assertions.
 *
 * @internal Exported for unit testing.
 */
export function resolvePrismaTransactionTimeoutOptions(
  env: PrismaTransactionTimeoutEnv,
): PrismaTransactionTimeoutOptions | undefined {
  const maxWait = parseOptionalPositiveIntegerMs(env.PRISMA_TRANSACTION_MAX_WAIT_MS);
  const timeout = parseOptionalPositiveIntegerMs(env.PRISMA_TRANSACTION_TIMEOUT_MS);

  if (maxWait === undefined && timeout === undefined) {
    return undefined;
  }

  return {
    ...(maxWait === undefined ? {} : { maxWait }),
    ...(timeout === undefined ? {} : { timeout }),
  };
}
