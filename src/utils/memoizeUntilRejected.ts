/**
 * Memoize an async loader (typically a lazy `import()`), sharing the in-flight
 * and resolved promise, but forget a rejected one so the next call retries.
 * A cached rejection would otherwise fail every later call until a full page
 * reload, e.g. after a deploy replaced the chunk the old page references.
 */
export function memoizeUntilRejected<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    const attempt = load();
    pending = attempt;
    // `pending` is only replaced once this handler has cleared it, so it is
    // still `attempt` here.
    attempt.catch(() => {
      pending = null;
    });
    return attempt;
  };
}
