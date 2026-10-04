import type { AcceptedTake } from './recording';

export function advanceImportedTakeQueue(queue: AcceptedTake[]): { next: AcceptedTake | null; remaining: AcceptedTake[] } {
  const [next, ...remaining] = queue;
  return { next: next ?? null, remaining };
}
