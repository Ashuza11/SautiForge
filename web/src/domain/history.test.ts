import { describe, expect, it } from 'vitest';

import { History } from './history';

describe('undo history', () => {
  it('undoes and redoes edits in order', () => {
    const history = new History<string>();
    history.record('a'); // edit a -> b
    history.record('b'); // edit b -> c
    expect(history.undoCount).toBe(2);
    expect(history.undo('c')).toBe('b');
    expect(history.undo('b')).toBe('a');
    expect(history.undo('a')).toBeNull();
    expect(history.redo('a')).toBe('b');
    expect(history.redo('b')).toBe('c');
    expect(history.redo('c')).toBeNull();
  });

  it('drops redo steps when a new edit is made after undoing', () => {
    const history = new History<string>();
    history.record('a');
    history.undo('b');
    expect(history.redoCount).toBe(1);
    history.record('a');
    expect(history.redoCount).toBe(0);
  });

  it('keeps only the most recent steps up to the limit', () => {
    const history = new History<number>(3);
    for (let i = 0; i < 10; i += 1) history.record(i);
    expect(history.undoCount).toBe(3);
    expect(history.undo(10)).toBe(9);
    expect(history.undo(9)).toBe(8);
    expect(history.undo(8)).toBe(7);
    expect(history.undo(7)).toBeNull();
  });

  it('clears everything', () => {
    const history = new History<string>();
    history.record('a');
    history.undo('b');
    history.clear();
    expect([history.undoCount, history.redoCount]).toEqual([0, 0]);
  });

  it('treats falsy states as real states', () => {
    const history = new History<number>();
    history.record(0);
    expect(history.undo(1)).toBe(0);
    expect(history.redo(0)).toBe(1);
  });
});
