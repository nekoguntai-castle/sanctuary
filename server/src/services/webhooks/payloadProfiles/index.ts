import type { WebhookEndpoint } from '../../../generated/prisma/client';
import { genericWebhookPayloadProfile } from './generic';
import { mappedJsonWebhookPayloadProfile } from './mappedJson';
import {
  GENERIC_WEBHOOK_PROFILE,
  type BuiltWebhookRequest,
  type WalletWebhookEvent,
  type WebhookPayloadProfile,
  type WebhookPayloadProfileHandler,
} from '../types';

const payloadProfiles = new Map<string, WebhookPayloadProfileHandler>([
  [genericWebhookPayloadProfile.id, genericWebhookPayloadProfile],
  [mappedJsonWebhookPayloadProfile.id, mappedJsonWebhookPayloadProfile],
]);

export function getWebhookPayloadProfile(profile: string): WebhookPayloadProfileHandler {
  return payloadProfiles.get(profile) ?? genericWebhookPayloadProfile;
}

export function getAvailableWebhookPayloadProfiles(): WebhookPayloadProfile[] {
  return Array.from(payloadProfiles.keys()) as WebhookPayloadProfile[];
}

export async function buildWebhookRequest(
  endpoint: WebhookEndpoint,
  event: WalletWebhookEvent,
): Promise<BuiltWebhookRequest> {
  return getWebhookPayloadProfile(endpoint.payloadProfile || GENERIC_WEBHOOK_PROFILE)
    .build(endpoint, event);
}
