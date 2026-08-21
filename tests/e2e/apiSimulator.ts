import type { Route } from '@playwright/test';

import { json, unmocked } from './helpers';

export interface MockApiResponse {
  status?: number;
  body: unknown;
}

export interface ParsedApiRoute {
  method: string;
  path: string;
  requestKey: string;
}

export type ApiResponseMap = Readonly<Record<string, MockApiResponse>>;

export type DynamicApiResponse = (
  parsedRoute: ParsedApiRoute,
) => MockApiResponse | null | Promise<MockApiResponse | null>;

export interface StaticApiSimulatorOptions {
  responses: ApiResponseMap;
  overrides?: ApiResponseMap;
  dynamicResponse?: DynamicApiResponse;
}

export interface StaticApiSimulator {
  handler: (route: Route) => Promise<void>;
  unhandledRequests: string[];
}

export const mockResponse = (
  body: unknown,
  status?: number,
): MockApiResponse => ({ body, status });

export function parseApiRequest(method: string, requestUrl: string): ParsedApiRoute {
  const path = new URL(requestUrl).pathname.replace(/^\/api\/v1(?=\/|$)/, '');
  return { method, path, requestKey: `${method} ${path}` };
}

export function parseApiRoute(route: Route): ParsedApiRoute {
  const request = route.request();
  return parseApiRequest(request.method(), request.url());
}

export async function resolveApiResponse(
  parsedRoute: ParsedApiRoute,
  options: StaticApiSimulatorOptions,
): Promise<MockApiResponse | null> {
  const override = options.overrides?.[parsedRoute.requestKey];
  if (override) return override;

  const dynamicResponse = await options.dynamicResponse?.(parsedRoute);
  if (dynamicResponse) return dynamicResponse;

  return options.responses[parsedRoute.requestKey] ?? null;
}

export function createStaticApiSimulator(
  options: StaticApiSimulatorOptions,
): StaticApiSimulator {
  const unhandledRequests: string[] = [];

  return {
    unhandledRequests,
    handler: async (route) => {
      const parsedRoute = parseApiRoute(route);
      const response = await resolveApiResponse(parsedRoute, options);
      if (response) {
        await json(route, response.body, response.status);
        return;
      }

      unhandledRequests.push(parsedRoute.requestKey);
      await unmocked(route, parsedRoute.method, parsedRoute.path);
    },
  };
}
