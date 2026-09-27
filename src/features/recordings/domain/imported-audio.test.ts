import { describe, expect, it } from 'vitest';

import { describeImportedAudio, importedDurationMs } from './imported-audio';

describe('external audio import', () => {
  it('preserves supported original containers and MIME types', () => {
    expect(describeImportedAudio('voice-note.opus', 'audio/opus')).toEqual({ extension: '.opus', container: 'opus', mimeType: 'audio/opus' });
    expect(describeImportedAudio('clip.ogg', 'audio/ogg')).toEqual({ extension: '.ogg', container: 'ogg', mimeType: 'audio/ogg' });
  });

  it('infers an extension from a trustworthy audio MIME type', () => {
    expect(describeImportedAudio('voice-note', 'audio/mp4').extension).toBe('.m4a');
  });

  it('accepts a supported extension when Android reports a generic binary MIME type', () => {
    expect(describeImportedAudio('whatsapp-voice-note.opus', 'application/octet-stream')).toEqual({
      extension: '.opus', container: 'opus', mimeType: 'application/octet-stream',
    });
  });

  it('rejects non-audio or unsupported files', () => {
    expect(() => describeImportedAudio('notes.pdf', 'application/pdf')).toThrow(/audio file/);
    expect(() => describeImportedAudio('voice.xyz', 'audio/x-unknown')).toThrow(/not supported/);
  });

  it('requires a finite positive decoded duration', () => {
    expect(importedDurationMs(2.345)).toBe(2345);
    expect(() => importedDurationMs(0)).toThrow(/could not be determined/);
  });
});
