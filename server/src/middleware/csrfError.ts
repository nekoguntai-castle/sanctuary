type StatusError = Error & {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

/** Match only the error contract emitted by the configured csrf-csrf engine. */
export function isInvalidCsrfTokenError(error: unknown): error is StatusError {
  if (!(error instanceof Error)) {
    return false;
  }
  const statusError = error as StatusError;
  return (
    statusError.code === 'EBADCSRFTOKEN' &&
    statusError.message === 'invalid csrf token' &&
    (statusError.status === 403 || statusError.statusCode === 403)
  );
}
