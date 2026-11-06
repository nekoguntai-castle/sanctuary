export declare function verifyServer(
  chromium: unknown,
  server: unknown,
  policy: { uid: number; browserVersion?: string; [key: string]: unknown }
): Promise<Record<string, unknown>>;
