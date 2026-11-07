export declare function engineSocketFromEnv(env?: NodeJS.ProcessEnv): string;
export declare function parseCommand(argv: string[]): string[];
export declare function createBrowserPayload(input: {
  image?: string;
  profile: string;
  profileHash: string;
  networkContainerId: string;
  runId: string;
  env: string[];
  ownership: Record<string, unknown>;
}): Record<string, unknown>;
export declare function assertOuterContainer(inspect: unknown, hostname: string): string;
export declare function resolveOuterHostname(environmentHostname?: string, kernelHostname?: string): string;
export declare function assertBrowserChild(inspect: unknown, input: { profile: string; outerId: string; imageId: string }): void;
export declare function runSandboxedPlaywright(args: string[], dependencies?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function readBrowserCpuThrottling(
  context: { socket?: string; containerId?: string | null; endpoint?: string | null },
  api: (...args: any[]) => Promise<any>,
  timeoutMs?: number
): Promise<{ cpuThrottling: { usage_usec: number; nr_throttled: number; throttled_usec: number } | null; reason?: string }>;
