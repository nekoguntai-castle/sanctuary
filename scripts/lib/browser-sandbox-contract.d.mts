export function validateBrowserSandboxEvidence(evidence?: unknown): { ok: boolean; errors: string[] };
export function formatBrowserError(error: unknown, options?: { stack?: boolean }): string;
export function createBrowserErrorRedactor(write: (text: string) => unknown): {
  write(chunk: string): void;
  flush(): void;
};
