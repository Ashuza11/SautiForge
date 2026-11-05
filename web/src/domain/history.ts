/**
 * Undo and redo for immutable states. Each edit records the state it replaced; a new edit
 * discards anything that could have been redone. Keeps at most `limit` steps.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 200) {}

  get undoCount(): number { return this.past.length; }
  get redoCount(): number { return this.future.length; }

  /** Call with the state that is about to be replaced. */
  record(previous: T): void {
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** Returns the state to go back to, or null when there is nothing to undo. */
  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    return previous;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
