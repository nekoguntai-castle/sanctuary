import dns from "node:dns/promises";
import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";

import {
  evaluateProviderEndpoint,
  validateProviderResolvedAddresses,
  type ProviderResolvedAddress,
} from "./endpointPolicy";
import {
  requestPinnedProviderAddress,
  type ProviderNativeRequest,
  type ProviderNativeResponse,
} from "./providerNativeTransport";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);
const ENTITY_HEADERS = new Set([
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-type",
  "digest",
  "transfer-encoding",
]);

export interface ProviderRequestInput {
  url: string | URL;
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string | Buffer;
  timeoutMs: number;
}

export interface ProviderResponse {
  url: URL;
  status: number;
  ok: boolean;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export type ProviderAddressLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

interface ProviderHttpClientDeps {
  lookup?: ProviderAddressLookup;
  transport?: (input: ProviderNativeRequest) => Promise<ProviderNativeResponse>;
}

interface RedirectRequestState {
  body?: Buffer;
  headers: Record<string, string>;
  method: string;
  url: URL;
}

function abortError(): Error {
  const error = new Error("Provider request deadline exceeded");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[/, "").replace(/\]$/, "");
}

async function resolveAddresses(
  url: URL,
  signal: AbortSignal,
  lookup: ProviderAddressLookup,
): Promise<ProviderResolvedAddress[]> {
  const hostname = normalizedHostname(url);
  const family = isIP(hostname);
  if (family === 4 || family === 6) {
    return [{ address: hostname, family }];
  }

  const answers = await raceWithAbort(
    lookup(hostname, { all: true, verbatim: true }),
    signal,
  );
  return answers.map(({ address, family: answerFamily }) => ({
    address,
    family: answerFamily as 4 | 6,
  }));
}

function prepareHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const prepared = { ...headers };
  removeHeaders(prepared, new Set(["accept-encoding"]));
  prepared["Accept-Encoding"] = "identity";
  return prepared;
}

function removeHeaders(
  headers: Record<string, string>,
  names: ReadonlySet<string>,
): void {
  for (const name of Object.keys(headers)) {
    if (names.has(name.toLowerCase())) delete headers[name];
  }
}

function stripFragment(url: URL): URL {
  const normalized = new URL(url);
  normalized.hash = "";
  return normalized;
}

function canonicalOrigin(url: URL): string {
  return url.origin.toLowerCase();
}

function locationHeader(response: ProviderNativeResponse): string {
  if (response.locationHeaders.length !== 1) {
    throw new Error("Provider redirect is missing a valid Location header");
  }
  const [location] = response.locationHeaders;
  if (!location?.trim()) {
    throw new Error("Provider redirect is missing a valid Location header");
  }
  return location;
}

function redirectedMethod(
  status: number,
  currentMethod: string,
): { method: string; dropBody: boolean } {
  const method = currentMethod.toUpperCase();
  const convertsPost = (status === 301 || status === 302) && method === "POST";
  const convertsOther = status === 303 && method !== "GET" && method !== "HEAD";
  return convertsPost || convertsOther
    ? { method: "GET", dropBody: true }
    : { method, dropBody: false };
}

function buildRedirectState(
  current: RedirectRequestState,
  response: ProviderNativeResponse,
): RedirectRequestState {
  const nextUrl = stripFragment(new URL(locationHeader(response), current.url));
  if (current.url.protocol === "https:" && nextUrl.protocol === "http:") {
    throw new Error("Provider redirect cannot downgrade HTTPS to HTTP");
  }

  const nextHeaders = { ...current.headers };
  if (canonicalOrigin(current.url) !== canonicalOrigin(nextUrl)) {
    removeHeaders(nextHeaders, CREDENTIAL_HEADERS);
  }

  const conversion = redirectedMethod(response.status, current.method);
  if (conversion.dropBody) removeHeaders(nextHeaders, ENTITY_HEADERS);
  return {
    url: nextUrl,
    method: conversion.method,
    headers: nextHeaders,
    ...(conversion.dropBody ? {} : { body: current.body }),
  };
}

async function requestHop(
  state: RedirectRequestState,
  signal: AbortSignal,
  deps: Required<ProviderHttpClientDeps>,
): Promise<ProviderNativeResponse> {
  throwIfAborted(signal);
  const decision = evaluateProviderEndpoint(state.url.toString());
  if (!decision.allowed) {
    throw new Error(decision.reason ?? "endpoint_not_allowed");
  }

  const answers = await resolveAddresses(state.url, signal, deps.lookup);
  const validated = validateProviderResolvedAddresses(answers, decision);
  throwIfAborted(signal);
  return deps.transport({
    url: state.url,
    resolvedAddress: validated[0]!.address,
    method: state.method,
    headers: state.headers,
    signal,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    ...(state.body === undefined ? {} : { body: state.body }),
  });
}

async function followRedirects(
  initial: RedirectRequestState,
  signal: AbortSignal,
  deps: Required<ProviderHttpClientDeps>,
): Promise<ProviderResponse> {
  const visited = new Set<string>();
  let state = initial;
  let redirects = 0;

  while (true) {
    const visitKey = `${state.method}:${state.url.toString()}`;
    if (visited.has(visitKey))
      throw new Error("Provider redirect loop detected");
    visited.add(visitKey);

    const response = await requestHop(state, signal, deps);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        url: state.url,
        ok: response.status >= 200 && response.status < 300,
      };
    }
    if (redirects >= MAX_REDIRECTS) {
      throw new Error("Provider redirect limit exceeded");
    }
    state = buildRedirectState(state, response);
    redirects += 1;
  }
}

export async function requestProviderEndpoint(
  input: ProviderRequestInput,
  dependencies: ProviderHttpClientDeps = {},
): Promise<ProviderResponse> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("Provider request timeout must be a positive integer");
  }
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), input.timeoutMs);
  const deps: Required<ProviderHttpClientDeps> = {
    lookup: dependencies.lookup ?? dns.lookup,
    transport: dependencies.transport ?? requestPinnedProviderAddress,
  };

  try {
    const initial: RedirectRequestState = {
      url: stripFragment(new URL(input.url)),
      method: (input.method ?? "GET").toUpperCase(),
      headers: prepareHeaders(input.headers),
      ...(input.body === undefined
        ? {}
        : {
            body: Buffer.isBuffer(input.body)
              ? input.body
              : Buffer.from(input.body),
          }),
    };
    return await followRedirects(initial, controller.signal, deps);
  } catch (error) {
    if (controller.signal.aborted) throw abortError();
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}
