import { diffText } from './text-diff';

export type Transcript = { id: string; contributorId: string; pseudonym: string; text: string; createdAt: string };
export type ClipResult = { clipId: string; clipKey: string; durationMs: number; position: number; status: string; transcripts: Transcript[]; skips: number };
export type BatchResult = { batch: { id: string; title: string; status: 'open' | 'closed'; createdAt: string }; clips: ClipResult[]; volunteers: number };
export type SourceResults = { required: number; volunteers: number; batches: BatchResult[] };

export type ClipState = 'waiting' | 'partial' | 'agree' | 'differ';

/** Waiting (nobody yet), partial (some answers), then agree or differ once enough people have written it. */
export function clipState(clip: ClipResult, required: number): ClipState {
  const count = clip.transcripts.length;
  if (count === 0) return 'waiting';
  if (count < required) return 'partial';
  const first = clip.transcripts[0]?.text;
  return clip.transcripts.every((item) => item.text === first) ? 'agree' : 'differ';
}

export const stateLabels: Record<ClipState, string> = {
  waiting: 'Waiting',
  partial: '1 answer',
  agree: 'Agree',
  differ: 'Differ',
};

export function stateLabel(clip: ClipResult, required: number): string {
  const state = clipState(clip, required);
  return state === 'partial' ? `${clip.transcripts.length} of ${required}` : stateLabels[state];
}

export function batchProgress(item: BatchResult, required: number) {
  const states = item.clips.map((clip) => clipState(clip, required));
  const published = item.clips.filter((clip) => clip.status === 'published').length;
  return {
    clips: item.clips.length,
    published,
    complete: states.filter((state) => state === 'agree' || state === 'differ').length,
    agree: states.filter((state) => state === 'agree').length,
    differ: states.filter((state) => state === 'differ').length,
    answers: item.clips.reduce((sum, clip) => sum + Math.min(clip.transcripts.length, required), 0),
    needed: item.clips.length * required,
  };
}

export function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.min(100, Math.round((part / whole) * 100));
}

export function summarize(results: SourceResults) {
  const all = results.batches.flatMap((item) => item.clips.map((clip) => clipState(clip, results.required)));
  return {
    volunteers: results.volunteers,
    answers: results.batches.reduce((sum, item) => sum + item.clips.reduce((inner, clip) => inner + clip.transcripts.length, 0), 0),
    complete: all.filter((state) => state === 'agree' || state === 'differ').length,
    needLook: all.filter((state) => state === 'differ').length,
  };
}

/** Compares the first two different versions of a clip; null when there is nothing to compare. */
export function firstDifference(clip: ClipResult) {
  const first = clip.transcripts[0];
  const other = clip.transcripts.find((item) => item.text !== first?.text);
  return first && other ? { first, other, diff: diffText(first.text, other.text) } : null;
}

const LETTERS = 'ABCDEFGHIJ';

/** Distinct versions of a clip, labelled A, B, C. Nicknames are left out on purpose. */
export function versions(clip: ClipResult): { label: string; text: string }[] {
  const distinct = [...new Set(clip.transcripts.map((item) => item.text))];
  return distinct.map((text, index) => ({ label: LETTERS[index] ?? String(index + 1), text }));
}

export function clipDifferenceBlock(clip: ClipResult): string {
  const lines = versions(clip).map((version) => `${version.label}) ${version.text}`);
  return [`Clip ${clip.clipKey}`, ...lines].join('\n');
}

/** A message for the community group asking which version is right. */
export function differencesMessage(clips: ClipResult[], required: number): string | null {
  const differing = clips.filter((clip) => clipState(clip, required) === 'differ');
  if (differing.length === 0) return null;
  return [
    'Which words are right? 🤔',
    differing.length === 1 ? 'We heard two different versions of a clip.' : `We heard different versions of ${differing.length} clips.`,
    '',
    differing.map(clipDifferenceBlock).join('\n\n'),
    '',
    'Reply with the letter that is right, or write the correct words. Thank you!',
  ].join('\n');
}
