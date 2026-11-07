import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createLazyEntry } from './vercel-entry';

describe('lazy Vercel entry', () => {
  it('builds the app once and forwards requests', async () => {
    const create = vi.fn(() => new Hono().get('/health', (c) => c.json({ status: 'ok' })));
    const entry = createLazyEntry(create);
    expect((await entry.request('/health')).status).toBe(200);
    expect((await entry.request('/health')).status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('returns 503 without leaking the reason when setup fails', async () => {
    const report = vi.fn();
    const entry = createLazyEntry(() => { throw new Error('DATABASE_URL secret detail'); }, report);
    const response = await entry.request('/v1/admin/ready');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('DATABASE_URL');
    expect(report).toHaveBeenCalledTimes(1);
    await entry.request('/health');
    expect(report).toHaveBeenCalledTimes(1);
  });
});
