const GENERIC_ERROR = 'Failed to get suggestion. AI may be unavailable.';

export const getAILabelSuggestionErrorMessage = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : '';

  if (msg.includes('503') || msg.includes('not enabled')) {
    return 'AI is not enabled. Configure it in Admin \u2192 AI Assistant.';
  }

  if (msg.includes('429') || msg.includes('rate limit')) {
    return 'AI rate limit reached \u2014 too many requests in a short period. Please wait a minute before trying again.';
  }

  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'Request timed out. The AI is taking too long to respond. Please try again.';
  }

  if (msg.includes('network') || msg.includes('fetch failed')) {
    return 'Network error. Please check your connection and try again.';
  }

  return GENERIC_ERROR;
};
