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

/** The message sent with each batch, in French. The admin can edit it before sending. */
export function shareMessage(input: { language: string; count: number; link: string }): string {
  const clips = input.count === 1 ? '1 court extrait' : `${input.count} courts extraits`;
  return [
    'Musingo ! 🙏',
    'Voici le challenge pour aujourd’hui.',
    '',
    `Écoutez ${clips} en ${input.language} et écrivez ce que vous entendez. Environ dix minutes, sans compte, depuis votre téléphone.`,
    '',
    `👉 ${input.link}`,
    '',
    'Si vous n’êtes pas d’accord avec une écriture ou une variante, dites-le ici : on en discute et on se corrige ensemble.',
    'Merci ! Faisons parler l’IA dans notre langue. 💪',
  ].join('\n');
}

export function newestFirst(batches: ApiBatch[]): ApiBatch[] {
  return [...batches].sort((a, b) => b.batch.createdAt.localeCompare(a.batch.createdAt));
}
