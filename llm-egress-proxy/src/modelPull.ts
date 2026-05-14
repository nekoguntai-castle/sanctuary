import { createLogger } from './logger';
import { extractErrorMessage } from './utils';

const log = createLogger('AI');

/**
 * Stream model pull progress to backend.
 */
export async function streamModelPull(
  model: string,
  ollamaEndpoint: string,
  backendUrl: string,
): Promise<void> {
  const callbackUrl = `${backendUrl}/internal/ai/pull-progress`;

  const sendProgress = async (data: {
    model: string;
    status: string;
    completed?: number;
    total?: number;
    digest?: string;
    error?: string;
  }) => {
    try {
      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      log.warn('Failed to send progress', { error: extractErrorMessage(err) });
    }
  };

  try {
    await sendProgress({ model, status: 'pulling' });

    const response = await fetch(`${ollamaEndpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: AbortSignal.timeout(600000),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error('Pull failed', { error });
      await sendProgress({ model, status: 'error', error });
      return;
    }

    if (!response.body) {
      await sendProgress({ model, status: 'error', error: 'No response body' });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line) as {
            status?: string;
            digest?: string;
            total?: number;
            completed?: number;
          };

          let status = 'downloading';
          if (data.status === 'pulling manifest') status = 'pulling';
          else if (data.status?.includes('verifying')) status = 'verifying';
          else if (data.status === 'success') status = 'complete';

          await sendProgress({
            model,
            status,
            completed: data.completed || 0,
            total: data.total || 0,
            digest: data.digest,
          });
        } catch {
          // Ignore malformed JSON lines from the Ollama stream.
        }
      }
    }

    log.info('Pull completed', { model });
    await sendProgress({ model, status: 'complete' });
  } catch (error) {
    log.error('Pull error', { error: extractErrorMessage(error) });
    await sendProgress({ model, status: 'error', error: extractErrorMessage(error) });
  }
}
