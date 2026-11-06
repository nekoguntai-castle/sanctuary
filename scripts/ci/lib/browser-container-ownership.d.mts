export interface BrowserContainerOwnership {
  project: string;
  deploymentId: string;
  ownerId: string;
  operationRunId: string;
  createdAt: string;
  createdByRelease: string;
  createdByCommit: string;
  checkoutRoot: string;
  runtimeDirectory: string;
  ownershipRoot: string;
  statePath: string;
  engineEndpoint: string;
  lifecycle: 'obsolete';
  cleanupPolicy: 'exact_delete';
}

export type BrowserContainerContext = Record<string, unknown>;
export type BrowserContainerApi = (
  socket: unknown, method: 'GET' | 'POST', pathname: string, body?: unknown
) => Promise<unknown>;
export type BrowserContainerCommand = (
  socket: unknown, args: string[], options?: { timeoutMs?: number }
) => Promise<{ stdout?: string }>;
export type BrowserContainerRegistration = (
  ownership: BrowserContainerOwnership, id: string
) => unknown;
export type BrowserChildAssertion = (
  inspect: unknown, input: { profile: string; outerId: string; imageId: string }
) => void;

export declare const RUNNER_OWNED_LABEL: string;
export declare function loadBrowserContainerOwnership(
  env: NodeJS.ProcessEnv,
  readState?: (statePath: string, options: { checkoutRoot: string }) => { state: Record<string, unknown> },
  resolveEngineContext?: (options: {
    engine: 'docker';
    runCommand: (engine: string, args: string[], options: { operation: string }) => string;
  }) => { engineGlobalArgs: [string, string] | string[] }
): BrowserContainerOwnership;
export declare function browserContainerOwnershipFromState(
  env: NodeJS.ProcessEnv,
  state: Record<string, unknown>,
  options: { checkoutRoot: string; statePath: string; engineEndpoint: string }
): BrowserContainerOwnership;
export declare function browserContainerOwnershipLabels(ownership: BrowserContainerOwnership): Record<string, string>;
export declare function assertBrowserContainerOwnership(
  inspect: unknown,
  ownership: BrowserContainerOwnership,
  options?: { id?: string; name?: string }
): string;
export declare function assertOwnedBrowserContainer(context: Record<string, unknown>, inspect: unknown): string;
export declare function recoverBrowserContainerId(context: BrowserContainerContext, api: BrowserContainerApi, cause: Error): Promise<string>;
export declare function registerAndReinspectBrowserContainer(
  context: BrowserContainerContext, api: BrowserContainerApi, register: BrowserContainerRegistration,
  assertBrowserChild: BrowserChildAssertion
): Promise<void>;
export declare function retireBrowserContainer(
  context: Record<string, unknown>, dependencies: {
    api: BrowserContainerApi;
    command: BrowserContainerCommand;
    assertBrowserChild: BrowserChildAssertion
  }
): Promise<Error | null | undefined>;
export declare function registerBrowserContainer(
  ownership: BrowserContainerOwnership,
  id: string,
  register?: (input: Record<string, unknown>, options: { root: string; checkoutRoot: string }) => unknown
): unknown;
