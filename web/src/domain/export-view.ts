export type ExportClip = {
  clipId: string; clipKey: string; transcript: string; finalVersion: number; note: string; durationMs: number; transcribers: number;
  sampleRate: number; derivedFrom: 'original' | 'cleaned'; flac: { url: string; sha256: string; sizeBytes: number; pcmSha256: string | null };
};
export type ExportManifest = {
  generatedAt: string;
  project: { id: string; title: string; languageCode: string; targetLanguage: string; languageVariety: string };
  source: { id: string; title: string; originalUrl: string | null; creator: string | null };
  rights: { decision: string; authorizedUses: Record<string, boolean> } | null;
  totals: { approved: number; excluded: number; notExported: number; durationMs: number };
  clips: ExportClip[];
};

function cell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A transcripts-only table that opens correctly in Excel (a byte-order mark keeps accents intact). */
export function transcriptsCsv(manifest: ExportManifest): string {
  const header = ['clip_id', 'transcript', 'final_version', 'duration_s', 'transcribers', 'note'];
  const rows = manifest.clips.map((clip) => [clip.clipKey, clip.transcript, clip.finalVersion, (clip.durationMs / 1000).toFixed(3), clip.transcribers, clip.note]);
  return `﻿${[header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

export function exportCommand(origin: string, sourceId: string): string {
  return `python -m sautiseg export-dataset --api ${origin.replace(/\/$/, '')} --source-id ${sourceId} --out dataset`;
}
