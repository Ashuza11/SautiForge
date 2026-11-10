export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 - 64 * 1024;

export type UploadPlan = { file: File; clipKey: string } | { file: File; clipKey: null; problem: string };

const CLIP_KEY = /^[A-Za-z0-9_-]{1,40}$/;

/** The clip's name is the file name without ".flac". Problems are explained in plain words. */
export function planUpload(file: File): UploadPlan {
  const name = file.name;
  if (!/\.flac$/i.test(name)) return { file, clipKey: null, problem: 'Only .flac files can be uploaded. Make them with the pack command.' };
  const key = name.replace(/\.flac$/i, '');
  if (!CLIP_KEY.test(key)) return { file, clipKey: null, problem: 'Rename the file using only letters, numbers, dash and underscore (up to 40 characters).' };
  if (file.size === 0) return { file, clipKey: null, problem: 'The file is empty.' };
  if (file.size > MAX_UPLOAD_BYTES) return { file, clipKey: null, problem: 'The file is larger than 4 MB.' };
  return { file, clipKey: key };
}

/** Removes repeated names so the same clip is not sent twice in one go. */
export function planUploads(files: File[]): UploadPlan[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const plan = planUpload(file);
    if (plan.clipKey === null) return plan;
    if (seen.has(plan.clipKey)) return { file, clipKey: null, problem: 'Another file with the same name is in this list.' } as const;
    seen.add(plan.clipKey);
    return plan;
  });
}

export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
