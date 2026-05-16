import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_FCM_SERVICE_ACCOUNT_PATH = '/app/config/fcm-service-account.json';
const DEFAULT_APNS_PRIVATE_KEY_PATH = '/app/config/apns-key.p8';

interface FcmServiceAccount {
  projectId?: string;
  privateKey?: string;
  clientEmail?: string;
}

export function getCorsAllowedOrigins() {
  const origins = process.env.CORS_ALLOWED_ORIGINS;
  if (!origins) {
    return [];
  }

  const parsedOrigins: string[] = [];
  for (const origin of origins.split(',')) {
    const trimmedOrigin = origin.trim();
    if (trimmedOrigin.length > 0) {
      parsedOrigins.push(trimmedOrigin);
    }
  }
  return parsedOrigins;
}

export function getGatewayRateLimitMax() {
  if (process.env.RATE_LIMIT_MAX !== undefined) {
    return process.env.RATE_LIMIT_MAX;
  }
  if (process.env.RATE_LIMIT_MAX_REQUESTS !== undefined) {
    return process.env.RATE_LIMIT_MAX_REQUESTS;
  }
  return '60';
}

export function getGatewayPort() {
  if (process.env.PORT !== undefined) {
    return process.env.PORT;
  }
  if (process.env.GATEWAY_PORT !== undefined) {
    return process.env.GATEWAY_PORT;
  }
  return '4000';
}

function readOptionalFile(filePath: string) {
  if (
    !filePath ||
    // nosemgrep -- Startup-only credential mount path from operator env/default, not request input.
    !existsSync(filePath)
  ) {
    return '';
  }

  try {
    // nosemgrep -- Startup-only credential mount path from operator env/default, not request input.
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function normalizePrivateKey(value: string | undefined) {
  if (value === undefined) {
    return '';
  }
  return value.replace(/\\n/g, '\n');
}

export function parseBooleanEnv(value: string | undefined, fallback = false) {
  if (value === undefined || value === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return fallback;
}

function readFcmServiceAccount(): FcmServiceAccount {
  const filePath = process.env.FCM_SERVICE_ACCOUNT_PATH === undefined
    ? DEFAULT_FCM_SERVICE_ACCOUNT_PATH
    : process.env.FCM_SERVICE_ACCOUNT_PATH;
  const raw = readOptionalFile(filePath);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      projectId: typeof parsed.project_id === 'string' ? parsed.project_id : undefined,
      privateKey: typeof parsed.private_key === 'string' ? parsed.private_key : undefined,
      clientEmail: typeof parsed.client_email === 'string' ? parsed.client_email : undefined,
    };
  } catch {
    return {};
  }
}

export function getFcmConfig() {
  const serviceAccount = readFcmServiceAccount();
  return {
    projectId: process.env.FCM_PROJECT_ID || serviceAccount.projectId || '',
    privateKey: normalizePrivateKey(process.env.FCM_PRIVATE_KEY) || normalizePrivateKey(serviceAccount.privateKey),
    clientEmail: process.env.FCM_CLIENT_EMAIL || serviceAccount.clientEmail || '',
  };
}

export function getApnsPrivateKey() {
  const envPrivateKey = normalizePrivateKey(process.env.APNS_PRIVATE_KEY);
  if (envPrivateKey) {
    return envPrivateKey;
  }

  const filePath = process.env.APNS_PRIVATE_KEY_PATH === undefined
    ? DEFAULT_APNS_PRIVATE_KEY_PATH
    : process.env.APNS_PRIVATE_KEY_PATH;
  return normalizePrivateKey(readOptionalFile(filePath));
}
