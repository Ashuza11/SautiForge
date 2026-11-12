import { boldDifferences, diffText } from './text-diff';

export type Transcript = { id: string; contributorId: string; pseudonym: string; text: string; createdAt: string };
export type FinalView = { version: number; decision: 'approved' | 'excluded'; text: string | null; note: string; createdAt: string };
export type ClipResult = {
  clipId: string; clipKey: string; durationMs: number; position: number; status: string; transcripts: Transcript[]; skips: number;
  final: FinalView | null;
};
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

/** A clip that differs and has no final decision yet. Once the admin decides, it stops asking for attention. */
export function needsDecision(clip: ClipResult, required: number): boolean {
  return clip.final === null && clipState(clip, required) === 'differ';
}

export function batchProgress(item: BatchResult, required: number) {
  const states = item.clips.map((clip) => clipState(clip, required));
  const published = item.clips.filter((clip) => clip.status === 'published').length;
  return {
    clips: item.clips.length,
    published,
    complete: states.filter((state) => state === 'agree' || state === 'differ').length,
    agree: states.filter((state) => state === 'agree').length,
    differ: item.clips.filter((clip) => needsDecision(clip, required)).length,
    answers: item.clips.reduce((sum, clip) => sum + Math.min(clip.transcripts.length, required), 0),
    needed: item.clips.length * required,
  };
}

export function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.min(100, Math.round((part / whole) * 100));
}

export function summarize(results: SourceResults) {
  const clips = results.batches.flatMap((item) => item.clips);
  const all = clips.map((clip) => clipState(clip, results.required));
  return {
    approved: clips.filter((clip) => clip.final?.decision === 'approved').length,
    volunteers: results.volunteers,
    answers: results.batches.reduce((sum, item) => sum + item.clips.reduce((inner, clip) => inner + clip.transcripts.length, 0), 0),
    complete: all.filter((state) => state === 'agree' || state === 'differ').length,
    needLook: clips.filter((clip) => needsDecision(clip, results.required)).length,
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

/** One clip for WhatsApp: each version labelled A, B, C, with the words that differ in bold. */
export function clipDifferenceBlock(clip: ClipResult): string {
  const all = versions(clip);
  const lines = all.map((version, index) => {
    const compared = all[index === 0 ? 1 : 0]?.text ?? '';
    return `${version.label}) ${boldDifferences(version.text, compared)}`;
  });
  return [`Extrait ${clip.clipKey}`, ...lines].join('\n');
}

const DIFFERENCES_HELP = 'Les mots en *gras* sont ceux qui diffèrent.';
const DIFFERENCES_ASK = 'Répondez avec la lettre qui est juste, ou écrivez les bons mots. Merci !';

/** One clip, ready to post in the community group. */
export function clipDifferencesMessage(clip: ClipResult): string {
  return ['Quels mots sont justes ? 🤔', DIFFERENCES_HELP, '', clipDifferenceBlock(clip), '', DIFFERENCES_ASK].join('\n');
}

/** A message for the community group asking which version is right. */
export function differencesMessage(clips: ClipResult[], required: number): string | null {
  const differing = clips.filter((clip) => needsDecision(clip, required));
  if (differing.length === 0) return null;
  return [
    'Quels mots sont justes ? 🤔',
    differing.length === 1 ? 'Nous avons entendu deux versions différentes d’un extrait.' : `Nous avons entendu des versions différentes pour ${differing.length} extraits.`,
    DIFFERENCES_HELP,
    '',
    differing.map(clipDifferenceBlock).join('\n\n'),
    '',
    DIFFERENCES_ASK,
  ].join('\n');
}

export type Badge = { label: string; kind: 'approved' | 'excluded' | ClipState };

/** The final decision, when there is one, is what the admin cares about most. */
export function clipBadge(clip: ClipResult, required: number): Badge {
  if (clip.final?.decision === 'approved') return { label: 'Approved', kind: 'approved' };
  if (clip.final?.decision === 'excluded') return { label: 'Excluded', kind: 'excluded' };
  return { label: stateLabel(clip, required), kind: clipState(clip, required) };
}

export function approvedCount(item: BatchResult): number {
  return item.clips.filter((clip) => clip.final?.decision === 'approved').length;
}
