import { describe, expect, it } from 'vitest';

import { acceptedTakeSchema, elicitationPromptSelectionError, recordingMetadataDraftSchema } from './recording';

describe('recording metadata validation', () => {
  it('requires at least one spoken language', () => {
    const result = recordingMetadataDraftSchema.safeParse({
      spokenLanguages: [],
      languageVariety: null,
      codeSwitchingStatus: 'unknown',
      recordingEnvironment: 'Indoor shop',
      noiseLevel: 'low',
      qualityRating: 4,
      notes: null,
      annotationStatus: 'needs_transcription',
    });
    expect(result.success).toBe(false);
  });

  it('rejects quality ratings outside the 1–5 scale', () => {
    const result = recordingMetadataDraftSchema.safeParse({
      spokenLanguages: ['Kingwana'],
      languageVariety: 'Bukavu',
      codeSwitchingStatus: 'none',
      recordingEnvironment: 'Indoor shop',
      noiseLevel: 'low',
      qualityRating: 6,
      notes: null,
      annotationStatus: 'needs_transcription',
    });
    expect(result.success).toBe(false);
  });
});

describe('accepted take provenance', () => {
  it('requires a hash, transport, import time, and submission code for imported audio', () => {
    const result = acceptedTakeSchema.safeParse({
      sourceUri: 'file:///cache/voice-note.ogg',
      durationMs: 1500,
      recordedAt: '2026-09-24T09:59:00.000+02:00',
      extension: '.ogg',
      container: 'ogg',
      codec: null,
      sampleRateHz: null,
      channelCount: null,
      captureSource: 'imported_file',
      transport: null,
      promptExposure: 'example_shown',
      importedAt: null,
      sourceMimeType: 'audio/ogg',
      contentSha256: null,
      externalSubmissionId: null,
      elicitationPromptText: null,
      sourceFileName: 'voice-note.ogg',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
      'transport', 'importedAt', 'contentSha256', 'externalSubmissionId', 'elicitationPromptText',
    ]);
  });
});

describe('elicitation prompt selection', () => {
  it('returns a clear instruction when an example-shown import has no selected example', () => {
    expect(elicitationPromptSelectionError({ promptExposure: 'example_shown', elicitationPromptText: null }))
      .toBe('Choose the example this audio responds to before saving.');
  });

  it('does not require an example for instructions-only audio', () => {
    expect(elicitationPromptSelectionError({ promptExposure: 'instructions_only', elicitationPromptText: null })).toBeNull();
  });
});
