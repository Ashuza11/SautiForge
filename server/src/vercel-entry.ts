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
  let invalidSettings: string[] = [];
  const entry = new Hono();
  entry.all('*', (context) => {
    if (!cached && !failed) {
      try {
        cached = create();
      } catch (error) {
        failed = true;
        invalidSettings = settingNames(error);
        report(error);
      }
    }
    if (!cached) return context.json({ error: 'server_not_configured', invalid_settings: invalidSettings }, 503);
    return cached.fetch(context.req.raw);
  });
  return entry;
}

/** Names of the invalid or missing settings only; never values or messages. */
function settingNames(error: unknown): string[] {
  const issues = (error as { issues?: unknown })?.issues;
  if (!Array.isArray(issues)) return [];
  const names = issues
    .map((issue) => (Array.isArray(issue?.path) ? String(issue.path[0] ?? '') : ''))
    .filter((name) => /^[A-Z][A-Z0-9_]{1,63}$/.test(name));
  return [...new Set(names)];
}
