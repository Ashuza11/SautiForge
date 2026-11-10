import { describe, expect, it } from 'vitest';

import { createRateLimiter, visitorKey } from './rate-limit';

describe('rate limiter', () => {
  it('lets a visitor through up to the limit, then waits for the window to pass', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => time });
    expect([1, 2, 3, 4].map(() => limiter.allow('a'))).toEqual([true, true, true, false]);
    time = 999;
    expect(limiter.allow('a')).toBe(false);
    time = 1001;
    expect(limiter.allow('a')).toBe(true);
  });

  it('keeps visitors separate and forgets old ones', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time, maxKeys: 2 });
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('b')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    time = 5000;
    expect(limiter.allow('c')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
  });

  it('reads the first address from the forwarding header', () => {
    expect(visitorKey('203.0.113.5, 10.0.0.1')).toBe('203.0.113.5');
    expect(visitorKey(undefined)).toBe('unknown');
    expect(visitorKey('')).toBe('unknown');
  });
});
