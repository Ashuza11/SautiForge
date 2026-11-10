import { describe, expect, it } from 'vitest';

import { formatSize, MAX_UPLOAD_BYTES, planUpload, planUploads } from './upload';

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name);

describe('upload planning', () => {
  it('names the clip after the file', () => {
    expect(planUpload(file('c001.flac'))).toMatchObject({ clipKey: 'c001' });
    expect(planUpload(file('Clip_7-b.FLAC'))).toMatchObject({ clipKey: 'Clip_7-b' });
  });

  it('explains every refusal in plain words', () => {
    expect(planUpload(file('a.wav'))).toMatchObject({ clipKey: null, problem: expect.stringContaining('.flac') });
    expect(planUpload(file('my clip!.flac'))).toMatchObject({ clipKey: null, problem: expect.stringContaining('Rename') });
    expect(planUpload(file('x'.repeat(41) + '.flac'))).toMatchObject({ clipKey: null });
    expect(planUpload(file('a.flac', 0))).toMatchObject({ clipKey: null, problem: 'The file is empty.' });
    expect(planUpload(file('a.flac', MAX_UPLOAD_BYTES + 1))).toMatchObject({ clipKey: null, problem: expect.stringContaining('4 MB') });
  });

  it('does not send the same name twice in one go', () => {
    const plans = planUploads([file('a.flac'), file('b.flac'), file('a.flac')]);
    expect(plans.map((plan) => plan.clipKey)).toEqual(['a', 'b', null]);
  });

  it('shows sizes people can read', () => {
    expect(formatSize(100)).toBe('1 KB');
    expect(formatSize(91 * 1024)).toBe('91 KB');
    expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});
