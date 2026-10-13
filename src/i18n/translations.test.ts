import { describe, expect, it } from 'vitest';

import { strings } from './en';
import { frenchStrings } from './fr';
import { swahiliStrings } from './sw';

describe('interface translations', () => {
  it.each([
    ['French', frenchStrings],
    ['Kiswahili', swahiliStrings],
  ])('%s has every English interface key with a non-empty value', (_name, translated) => {
    expect(Object.keys(translated).sort()).toEqual(Object.keys(strings).sort());
    expect(Object.values(translated).every((value) => value.trim().length > 0)).toBe(true);
  });

  it.each([
    ['French', frenchStrings],
    ['Kiswahili', swahiliStrings],
  ])('%s translates the critical collection workflow', (_name, translated) => {
    const criticalKeys = [
      'newParticipant',
      'saveConsent',
      'startSession',
      'startRecording',
      'selectExampleUsedError',
      'recordingSaved',
      'saveTranscription',
      'createResearchZip',
      'removeRecordingQuestion',
    ] as const;

    for (const key of criticalKeys) expect(translated[key]).not.toBe(strings[key]);
  });
});
