/**
 * Raised when a wallet sync targets a network that is explicitly disabled in
 * Node Configuration. The UI matches the error name and "sync is off" copy to
 * show a non-retryable warning.
 */
export class NetworkDisabledError extends Error {
  constructor(label: string) {
    super(
      `${label} sync is off in Node Configuration. Enable ${label} under Network Connections, save settings, then sync ${label.toLowerCase()} wallets again.`,
    );
    this.name = "NetworkDisabledError";
  }
}

export function isNetworkDisabledError(
  error: unknown,
): error is NetworkDisabledError {
  return (
    error instanceof NetworkDisabledError ||
    (error instanceof Error && error.name === "NetworkDisabledError")
  );
}
