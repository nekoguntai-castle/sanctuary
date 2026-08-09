export const CHAT_MESSAGE_MAX_LENGTH = 8000;

export function normalizeChatMessage(content: string): string | null {
  const normalized = content.trim();
  if (!normalized || normalized.length > CHAT_MESSAGE_MAX_LENGTH) return null;
  return normalized;
}

export function boundChatMessage(content: unknown): string {
  if (typeof content !== 'string') return '';
  const normalized = content.trim();
  return normalized.slice(0, CHAT_MESSAGE_MAX_LENGTH);
}
