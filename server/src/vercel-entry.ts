import { Hono } from 'hono';

/**
 * Builds a Hono app that creates the real server lazily on the first request,
 * so a missing setting returns a clean 503 instead of crashing at import time.
 */
export function createLazyEntry(
  create: () => Hono,
  report: (error: unknown) => void = (error) => console.error('Server failed to start', error),
): Hono {
  let cached: Hono | undefined;
  let failed = false;
  const entry = new Hono();
  entry.all('*', (context) => {
    if (!cached && !failed) {
      try {
        cached = create();
      } catch (error) {
        failed = true;
        report(error);
      }
    }
    if (!cached) return context.json({ error: 'server_not_configured' }, 503);
    return cached.fetch(context.req.raw);
  });
  return entry;
}
