/** Parse untrusted JSON without returning errors that can contain input fragments. */
export function safeJsonParse(text: string): { success: true; data: unknown } | { success: false } {
  try {
    return { success: true, data: JSON.parse(text) as unknown };
  } catch {
    return { success: false };
  }
}
