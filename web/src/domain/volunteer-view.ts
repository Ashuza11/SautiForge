export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const CONTRIBUTOR_KEY = 'sautiforge.volunteer';
const DRAFT_PREFIX = 'sautiforge.draft.';

/** `#/b/<batch id>.<code>` -> `<batch id>.<code>`, or null for anything else. */
export function parseBatchHash(hash: string): string | null {
  const match = /^#\/b\/([0-9a-f-]{36}\.[A-Za-z0-9_-]{24})$/.exec(hash);
  return match ? match[1] ?? null : null;
}

export type SavedContributor = { token: string; pseudonym: string };

function browserStorage(): StorageLike | null {
  try { return window.localStorage; } catch { return null; }
}

/** Storage can be blocked (private windows); the page must work without it. */
export function loadContributor(storage: StorageLike | null = browserStorage()): SavedContributor | null {
  try {
    const raw = storage?.getItem(CONTRIBUTOR_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedContributor>;
    return typeof value.token === 'string' && typeof value.pseudonym === 'string' ? { token: value.token, pseudonym: value.pseudonym } : null;
  } catch { return null; }
}

export function saveContributor(value: SavedContributor, storage: StorageLike | null = browserStorage()): void {
  try { storage?.setItem(CONTRIBUTOR_KEY, JSON.stringify(value)); } catch { /* the page still works */ }
}

export function clearContributor(storage: StorageLike | null = browserStorage()): void {
  try { storage?.removeItem(CONTRIBUTOR_KEY); } catch { /* ignore */ }
}

export function loadDraft(clipId: string, storage: StorageLike | null = browserStorage()): string {
  try { return storage?.getItem(DRAFT_PREFIX + clipId) ?? ''; } catch { return ''; }
}

export function saveDraft(clipId: string, text: string, storage: StorageLike | null = browserStorage()): void {
  try {
    if (text.trim() === '') storage?.removeItem(DRAFT_PREFIX + clipId); else storage?.setItem(DRAFT_PREFIX + clipId, text);
  } catch { /* ignore */ }
}

export function clearDraft(clipId: string, storage: StorageLike | null = browserStorage()): void {
  try { storage?.removeItem(DRAFT_PREFIX + clipId); } catch { /* ignore */ }
}

export const SPEEDS = [1, 0.75, 0.5] as const;
export type Speed = (typeof SPEEDS)[number];

export function nextSpeed(current: number): Speed {
  const index = SPEEDS.findIndex((speed) => speed === current);
  return SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
}

export function speedLabel(speed: number): string {
  return speed === 1 ? 'Normal' : speed === 0.75 ? 'Slower' : 'Slowest';
}

export function progressPercent(answered: number, total: number): number {
  return total <= 0 ? 0 : Math.min(100, Math.round((answered / total) * 100));
}

/** A nickname only: warn against what looks like a full real name or a phone number. */
export function nicknameProblem(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < 2) return 'Choose a nickname of at least 2 letters.';
  if (text.length > 40) return 'Choose a shorter nickname.';
  if (/\d{6,}/.test(text.replace(/[\s-]/g, ''))) return 'Please do not use a phone number. Choose a nickname.';
  if (/@/.test(text)) return 'Please do not use an email address. Choose a nickname.';
  return null;
}
