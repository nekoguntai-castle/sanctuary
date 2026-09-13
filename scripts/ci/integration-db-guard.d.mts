export function redactDatabaseUrl(url: string): string;
export function isAllowedIntegrationDbHost(hostname: string): boolean;
export function assertAllowedIntegrationDbTarget(
  url: string,
  env?: NodeJS.ProcessEnv
): void;
