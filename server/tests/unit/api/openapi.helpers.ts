import { expect } from 'vitest';
import openApiRouter, { openApiSpec } from '../../../src/api/openapi';

export {
  MOBILE_ACTIONS,
  MOBILE_API_REQUEST_LIMITS,
  MOBILE_DEVICE_ACCOUNT_PURPOSES,
  MOBILE_DEVICE_SCRIPT_TYPES,
  MOBILE_DRAFT_STATUS_VALUES,
} from '../../../../shared/schemas/mobileApiRequests';
export {
  TRANSFER_RESOURCE_TYPES,
  TRANSFER_ROLE_FILTER_VALUES,
  TRANSFER_STATUS_FILTER_VALUES,
  TRANSFER_STATUS_VALUES,
} from '../../../src/services/transferService/types';
export {
  INSIGHT_SEVERITY_VALUES,
  INSIGHT_STATUS_VALUES,
  INSIGHT_TYPE_VALUES,
  INSIGHT_UPDATE_STATUS_VALUES,
  INTELLIGENCE_ENDPOINT_TYPE_VALUES,
  INTELLIGENCE_MESSAGE_ROLE_VALUES,
} from '../../../src/services/intelligence/types';
export {
  AI_QUERY_AGGREGATION_VALUES,
  AI_QUERY_RESULT_TYPES,
  AI_QUERY_SORT_ORDERS,
} from '../../../src/services/ai/types';
export {
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
} from '../../../src/services/wallet/types';
export {
  WALLET_IMPORT_FORMAT_VALUES,
  WALLET_IMPORT_NETWORK_VALUES,
  WALLET_IMPORT_SCRIPT_TYPE_VALUES,
  WALLET_IMPORT_WALLET_TYPE_VALUES,
} from '../../../src/services/walletImport/types';
export { WALLET_EXPORT_FORMAT_VALUES } from '../../../src/services/export/types';
export { DEFAULT_AUTOPILOT_SETTINGS } from '../../../src/services/autopilot/types';
export {
  VALID_ENFORCEMENT_MODES,
  VALID_POLICY_TYPES,
  VALID_SOURCE_TYPES,
  VALID_VOTE_DECISIONS,
} from '../../../src/services/vaultPolicy/types';
export {
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_STATS_DAYS,
  DEFAULT_CONFIRMATION_THRESHOLD,
  DEFAULT_SMTP_FROM_NAME,
  DEFAULT_SMTP_PORT,
} from '../../../src/constants';
export { FEATURE_FLAG_KEYS } from '../../../src/services/featureFlags/definitions';
export { openApiSpec };

// ADR 0001 / ADR 0002 - every browser-mounted protected route advertises
// two auth alternatives: bearer (mobile/gateway) and cookie + CSRF (browser).
// The shared shape is imported/exported from `src/api/openapi/security.ts`
// as `browserOrBearerAuth`. Internal AI container routes continue to use
// bearer only and assert against `bearerOnlyAuth` below.
export const browserOrBearerAuthSecurity = [
  { bearerAuth: [] },
  { cookieAuth: [], csrfToken: [] },
];
export const bearerOnlyAuthSecurity = [{ bearerAuth: [] }];
export const agentBearerAuthSecurity = [{ agentBearerAuth: [] }];

type HandlerResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body?: unknown;
};

export const invokeRoute = (method: string, url: string) => new Promise<HandlerResponse>((resolve, reject) => {
  const req = { method, url } as any;
  const res: any = {
    statusCode: 200,
    headers: {},
    setHeader: (key: string, value: string) => {
      res.headers[key.toLowerCase()] = value;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    send: (body?: unknown) => {
      res.body = body;
      resolve({ statusCode: res.statusCode, headers: res.headers, body: res.body });
    },
    json: (body: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.body = body;
      resolve({ statusCode: res.statusCode, headers: res.headers, body: res.body });
    },
  };

  openApiRouter.handle(req, res, (err?: Error) => {
    if (err) {
      reject(err);
      return;
    }
    reject(new Error(`Route not handled: ${method} ${url}`));
  });
});

export type OpenApiPathKey = keyof typeof openApiSpec.paths;

export function expectDocumentedMethod(path: OpenApiPathKey, method: string) {
  const pathItem = openApiSpec.paths[path] as Record<string, unknown>;
  expect(pathItem).toBeDefined();
  expect(pathItem[method.toLowerCase()]).toBeDefined();
}
