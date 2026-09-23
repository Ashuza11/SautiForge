import { describe, expect, it } from 'vitest';

import { recordingMetadataDraftSchema } from './recording';

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
