export type DiffPart = { kind: 'same' | 'changed'; text: string };

export type TextDiff = {
  /** The first text with the characters that differ marked. */
  left: DiffPart[];
  /** The second text with the characters that differ marked. */
  right: DiffPart[];
  same: boolean;
  /** Characters that are in only one of the two texts. */
  differing: number;
  /** 0 to 100: how much the two texts have in common. */
  similarity: number;
};

/** Longest common subsequence over whole characters (code points), so accents and special letters stay intact. */
export function diffText(first: string, second: string): TextDiff {
  const a = Array.from(first);
  const b = Array.from(second);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? (table[(i + 1) * cols + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }

  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  const push = (parts: DiffPart[], kind: DiffPart['kind'], char: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += char; else parts.push({ kind, text: char });
  };

  let i = 0;
  let j = 0;
  let common = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(left, 'same', a[i] ?? ''); push(right, 'same', b[j] ?? ''); common += 1; i += 1; j += 1;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
      push(left, 'changed', a[i] ?? ''); i += 1;
    } else {
      push(right, 'changed', b[j] ?? ''); j += 1;
    }
  }
  for (; i < a.length; i += 1) push(left, 'changed', a[i] ?? '');
  for (; j < b.length; j += 1) push(right, 'changed', b[j] ?? '');

  const total = a.length + b.length;
  return {
    left,
    right,
    same: first === second,
    differing: total - 2 * common,
    similarity: total === 0 ? 100 : Math.round((2 * common * 100) / total),
  };
}
