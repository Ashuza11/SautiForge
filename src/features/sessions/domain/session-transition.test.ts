import { describe, expect, it } from 'vitest';

import { requireCompletedSessionForReopen } from './session-transition';

describe('session transitions', () => {
  it('allows a completed session to be reopened', () => {
    expect(() => requireCompletedSessionForReopen('completed')).not.toThrow();
  });

  it('rejects reopening unfinished or archived sessions', () => {
    expect(() => requireCompletedSessionForReopen('in_progress')).toThrow(/completed session/);
    expect(() => requireCompletedSessionForReopen('paused')).toThrow(/completed session/);
    expect(() => requireCompletedSessionForReopen('archived')).toThrow(/completed session/);
  });
});
