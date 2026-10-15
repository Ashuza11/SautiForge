import { webcrypto } from 'node:crypto';
import { strToU8 } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

import { audioMimeType, latestTranscription, loadResearchDataset, matchesRecordingQuery } from './dataset';
import { initialDraft } from './draft';
import { archiveInput, fixtureRecordingId, fixtureTime, makeResearchArchive } from '../test/research-archive-fixture';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
});

describe('browser research dataset import', () => {
  it('verifies a complete export and resolves its recording audio', async () => {
    const archive = await makeResearchArchive();
    const dataset = await loadResearchDataset(archiveInput('pilot.zip', archive));
    expect(dataset.manifest.exportType).toBe('research_dataset');
    expect(dataset.records.recordings).toHaveLength(1);
    expect(dataset.entries.get(`audio/${fixtureRecordingId}.opus`)).toBeDefined();
    expect(dataset.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    const recording = dataset.records.recordings[0];
    expect(matchesRecordingQuery(recording, 'SPK-001', 'Recording a sale', 'spk-001')).toBe(true);
    expect(matchesRecordingQuery(recording, 'SPK-001', 'Recording a sale', 'inventory')).toBe(false);
    expect(latestTranscription(dataset, recording.id)).toBeNull();
    expect(audioMimeType(recording.audio_path)).toBe('audio/ogg');
    expect(initialDraft(dataset, recording, new Date(fixtureTime))).toMatchObject({
      scenarioContext: 'Recording a sale',
      elicitationPromptContext: 'Example',
      verbatimText: 'Example',
      languageTags: ['Kingwana'],
      codeSwitchingStatus: 'present',
      annotationStatus: 'needs_transcription',
      businessLabels: expect.objectContaining({ transactionIntent: 'record_sale' }),
      updatedAt: fixtureTime,
    });
  });

  it('rejects an administrative backup before exposing its contents', async () => {
    const archive = await makeResearchArchive({ exportType: 'administrative_backup', sensitiveAdministrativeData: true });
    await expect(loadResearchDataset(archiveInput('private.zip', archive))).rejects.toThrow(/not a private administrative backup/);
  });

  it('rejects changed audio, unsafe references and undeclared members', async () => {
    const changedAudio = await makeResearchArchive({}, { audioBytes: strToU8('tampered') });
    await expect(loadResearchDataset(archiveInput('changed.zip', changedAudio))).rejects.toThrow(/Size mismatch|SHA-256 mismatch/);

    const unsafe = await makeResearchArchive({}, { recordingAudioPath: '../private.opus' });
    await expect(loadResearchDataset(archiveInput('unsafe.zip', unsafe))).rejects.toThrow(/audio_path|referenced audio|schema/);

    const extra = await makeResearchArchive({}, { extra: { 'private/consent.json': strToU8('{}') } });
    await expect(loadResearchDataset(archiveInput('extra.zip', extra))).rejects.toThrow(/Undeclared ZIP member/);
  });

  it('rejects a manifest count that does not match the dataset', async () => {
    const archive = await makeResearchArchive({ counts: { recordings: 2, participants: 1, sessions: 1, transcriptions: 0, annotations: 0 } });
    await expect(loadResearchDataset(archiveInput('count.zip', archive))).rejects.toThrow(/recordings count mismatch/);
  });
});
