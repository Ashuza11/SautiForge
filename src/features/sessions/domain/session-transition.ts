import type { CollectionSession } from './session';

export function requireCompletedSessionForReopen(status: CollectionSession['status']): void {
  if (status !== 'completed') throw new Error('Only a completed session can be reopened.');
}
