import type { ApiClip, ClipStatus } from '../api/client';

/** 318600 -> "5:18.6" */
export function formatClock(ms: number): string {
  const totalTenths = Math.round(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function speakerLabel(clip: ApiClip['clip']): string {
  const role = { narrator: 'Narrator', character: 'Character', multiple: 'Several voices', unknown: 'Unknown' }[clip.speakerRole];
  return clip.speakerName ? `${role} · ${clip.speakerName}` : role;
}

export type StatusFilter = ClipStatus | 'all';

export function filterClips(clips: ApiClip[], filter: StatusFilter): ApiClip[] {
  return filter === 'all' ? clips : clips.filter((item) => item.clip.status === filter);
}

export function summarizeClips(clips: ApiClip[]) {
  const published = clips.filter((item) => item.clip.status === 'published');
  return {
    total: clips.length,
    published: published.length,
    draft: clips.filter((item) => item.clip.status === 'draft').length,
    withdrawn: clips.filter((item) => item.clip.status === 'withdrawn').length,
    publishedMs: published.reduce((sum, item) => sum + item.clip.durationMs, 0),
    withOriginal: published.filter((item) => item.files.some((file) => file.variant === 'original')).length,
  };
}

export function formatTotal(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}
