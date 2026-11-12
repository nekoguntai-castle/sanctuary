import { buildWebsocketConfig } from './envSections';
import { WebSocketConfigSchema } from './schema';
import type { WebSocketConfig } from './types';

/**
 * Read and validate the WebSocket limits from the environment.
 *
 * The single reader for these variables. They used to be parsed a second time
 * in websocket/types.ts with a bare parseInt, so a typo became NaN and every
 * `count >= limit` check silently passed. An invalid value now stops startup.
 */
export function loadWebsocketConfig(): WebSocketConfig {
  const parsed = WebSocketConfigSchema.safeParse(buildWebsocketConfig());
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid WebSocket configuration: ${details}`);
  }
  return parsed.data;
}
