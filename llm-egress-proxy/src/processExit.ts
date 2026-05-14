type ExitCode = 0 | 1;

export function exitNow(code: ExitCode): never {
  process.exit(code);
}

export function exitAfterDelay(code: ExitCode, delayMs: number): NodeJS.Timeout {
  const timeout = setTimeout(() => exitNow(code), delayMs);
  timeout.unref?.();
  return timeout;
}
