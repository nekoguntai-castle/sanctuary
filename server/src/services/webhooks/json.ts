import { createHash } from 'node:crypto';

export function serializeWebhookBody(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

export function hashWebhookBody(body: Record<string, unknown>): string {
  return createHash('sha256').update(serializeWebhookBody(body)).digest('hex');
}

export function hashWebhookRawBody(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}
