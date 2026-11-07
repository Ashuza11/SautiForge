import { describe, expect, it } from 'vitest';

import { AdminSessionService } from './admin-session';

function service(clock: { now: Date }, overrides = {}) {
  return new AdminSessionService({
    password: 'correct horse battery',
    secret: 's'.repeat(32),
    ttlSeconds: 60,
    now: () => clock.now,
    ...overrides,
  });
}

describe('admin session', () => {
  it('signs a session for the right password and verifies it', () => {
    const clock = { now: new Date('2026-11-07T10:00:00Z') };
    const sessions = service(clock);
    const result = sessions.login('correct horse battery');
    expect(result).toHaveProperty('token');
    expect(sessions.verify((result as { token: string }).token)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const sessions = service({ now: new Date() });
    expect(sessions.login('nope')).toBeNull();
  });

  it('expires sessions', () => {
    const clock = { now: new Date('2026-11-07T10:00:00Z') };
    const sessions = service(clock);
    const { token } = sessions.login('correct horse battery') as { token: string };
    clock.now = new Date('2026-11-07T10:01:01Z');
    expect(sessions.verify(token)).toBe(false);
  });

  it('rejects forged, tampered and empty tokens', () => {
    const clock = { now: new Date('2026-11-07T10:00:00Z') };
    const sessions = service(clock);
    const { token } = sessions.login('correct horse battery') as { token: string };
    const [, signature] = token.split('.');
    expect(sessions.verify(`9999999999.${signature}`)).toBe(false);
    expect(sessions.verify('9999999999.forged')).toBe(false);
    expect(sessions.verify('garbage')).toBe(false);
    expect(sessions.verify(undefined)).toBe(false);
    const other = new AdminSessionService({ password: 'x', secret: 'z'.repeat(32), now: () => clock.now });
    expect(other.verify(token)).toBe(false);
  });

  it('locks logins after repeated failures, then recovers', () => {
    const clock = { now: new Date('2026-11-07T10:00:00Z') };
    const sessions = service(clock, { maxFailedAttempts: 3, lockoutSeconds: 30 });
    for (let i = 0; i < 3; i += 1) expect(sessions.login('bad')).toBeNull();
    expect(sessions.login('correct horse battery')).toEqual({ locked: true });
    clock.now = new Date('2026-11-07T10:00:31Z');
    expect(sessions.login('correct horse battery')).toHaveProperty('token');
  });
});
