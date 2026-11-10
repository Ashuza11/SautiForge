import type { ApiBatch, ApiClip } from '../api/client';

export const DEFAULT_BATCH_SIZE = 5;
export const MAX_BATCH_SIZE = 10;

/** Published clips that are not in a batch people can still open. */
export function availableClips(clips: ApiClip[], batches: ApiBatch[]): ApiClip[] {
  const taken = new Set(batches.filter((item) => item.batch.status === 'open').flatMap((item) => item.clipIds));
  return clips.filter((item) => item.clip.status === 'published' && !taken.has(item.clip.id));
}

export function defaultSelection(available: ApiClip[], size = DEFAULT_BATCH_SIZE): string[] {
  return available.slice(0, size).map((item) => item.clip.id);
}

/** The link volunteers open. The code is part of the address so nobody can guess it. */
export function batchLink(origin: string, item: Pick<ApiBatch, 'batch' | 'token'>): string {
  return `${origin.replace(/\/$/, '')}/#/b/${item.batch.id}.${item.token}`;
}

/** A friendly message for WhatsApp. The admin can edit it, for example to translate it. */
export function shareMessage(input: { language: string; count: number; link: string }): string {
  const clips = input.count === 1 ? '1 short clip' : `${input.count} short clips`;
  return [
    `Hello! 🙏 Help us write down our language, ${input.language}.`,
    `Listen to ${clips} and type what you hear. It takes about ten minutes, and you do not need an account.`,
    '',
    `👉 ${input.link}`,
    '',
    'Thank you for helping our language live on.',
  ].join('\n');
}

export function newestFirst(batches: ApiBatch[]): ApiBatch[] {
  return [...batches].sort((a, b) => b.batch.createdAt.localeCompare(a.batch.createdAt));
}
