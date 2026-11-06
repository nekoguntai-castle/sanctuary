export declare const BROWSER_CONTAINER_RESOURCES: Readonly<{
  Memory: number;
  NanoCpus: number;
  PidsLimit: number;
  ShmSize: number;
}>;

export declare function normalizeImageId(value: unknown): string | null;

export declare function createSeccompBrowserPayload(input: {
  image: string;
  user: string;
  command: string[];
  env?: string[];
  labels?: Record<string, string>;
  profile: string;
  networkMode: string;
  resources?: Record<string, number>;
  allowImageId?: boolean;
  readonlyRootfs?: boolean;
  tmpfs?: Record<string, string>;
}): {
  Image: string;
  User: string;
  Env: string[];
  Cmd: string[];
  Labels: Record<string, string>;
  HostConfig: Record<string, unknown>;
};

export declare function assertSeccompBrowserContainer(
  inspect: unknown,
  input: {
    imageId: string;
    user: string;
    profile: string;
    networkMode: string;
    resources?: Record<string, number>;
    readonlyRootfs?: boolean;
    tmpfs?: Record<string, string>;
  }
): void;

export declare function requestBrowserEngineApi(socketPath: string, method: string, endpoint: string, payload?: unknown, timeoutMs?: number): Promise<unknown>;
export declare function runBrowserEngineCli(socket: string, args: string[], options?: Record<string, unknown>): Promise<{ stdout: string; stderr: string }>;
