import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { archiveInput, fixtureRecordingId, makeResearchArchive } from '../test/research-archive-fixture';
import { createAnnotatedResearchArchive } from './annotated-export';
import { loadResearchDataset } from './dataset';
import { initialDraft } from './draft';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
});

describe('annotated research export', () => {
  it('creates and revalidates a derivative ZIP with original audio and human revisions', async () => {
    const source = await loadResearchDataset(archiveInput('pilot.zip', await makeResearchArchive()));
    const recording = source.records.recordings[0];
    const draft = {
      ...initialDraft(source, recording, new Date('2026-10-15T10:00:00.000Z')),
      verbatimText: 'Nimeuza kilo mbili za sukari na cinq mille francs.',
      normalizedText: 'Nimeuza kilo mbili za sukari kwa faranga elfu tano.',
      languageTags: ['Kingwana', 'French'],
      createdBy: 'ANNOTATOR-01',
      annotationStatus: 'transcribed' as const,
      codeSwitchingStatus: 'none' as const,
      businessLabels: { ...initialDraft(source, recording).businessLabels, transactionIntent: 'record_sale', quantity: '2', amount: '5000', currency: 'CDF' },
    };
    const ids = [
      '11f523b2-2db8-4f59-82e9-e70b182656f1',
      '21f523b2-2db8-4f59-82e9-e70b182656f1',
      '31f523b2-2db8-4f59-82e9-e70b182656f1',
    ];
    const output = await createAnnotatedResearchArchive(source, [draft], {
      now: new Date('2026-10-15T11:00:00.000Z'),
      newId: () => ids.shift() ?? crypto.randomUUID(),
    });
    const verified = await loadResearchDataset(archiveInput(output.fileName, output.bytes));

    expect(output.appliedDrafts).toBe(1);
    expect(output.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(verified.records.recordings[0].annotation_status).toBe('transcribed');
    expect(verified.records.recordings[0].code_switching_status).toBe('none');
    expect(verified.records.transcriptions).toMatchObject([{ source: 'human', revision_number: 1, verbatim_text: draft.verbatimText, created_by: 'ANNOTATOR-01' }]);
    expect(JSON.parse(verified.records.annotations[0].payload_json)).toMatchObject({ transactionIntent: 'record_sale', amount: '5000', currency: 'CDF' });
    expect(verified.records.annotations[0]).toMatchObject({ source: 'human', revision_number: 1, annotation_type: 'business.transaction' });
    expect(verified.entries.get(`audio/${fixtureRecordingId}.opus`)).toEqual(source.entries.get(`audio/${fixtureRecordingId}.opus`));
    expect(verified.entries.get('metadata/participants.csv')).toBeDefined();
    expect(verified.manifest.counts).toMatchObject({ recordings: 1, transcriptions: 1, annotations: 1, webDraftsApplied: 1 });

    const firstRevision = verified.records.transcriptions[0];
    const revisedDraft = {
      ...initialDraft(verified, verified.records.recordings[0], new Date('2026-10-15T12:00:00.000Z')),
      verbatimText: `${draft.verbatimText} Correction.`,
    };
    const revisionIds = ['41f523b2-2db8-4f59-82e9-e70b182656f1', '51f523b2-2db8-4f59-82e9-e70b182656f1'];
    const revisedOutput = await createAnnotatedResearchArchive(verified, [revisedDraft], {
      now: new Date('2026-10-15T13:00:00.000Z'),
      newId: () => revisionIds.shift() ?? crypto.randomUUID(),
    });
    const revised = await loadResearchDataset(archiveInput(revisedOutput.fileName, revisedOutput.bytes));
    expect(revised.records.transcriptions).toHaveLength(2);
    expect(revised.records.transcriptions[1]).toMatchObject({ revision_number: 2, supersedes_id: firstRevision.id, source: 'human' });
    expect(revised.records.annotations).toHaveLength(1);
  });

  it('rejects missing drafts and drafts from another source archive', async () => {
    const source = await loadResearchDataset(archiveInput('pilot.zip', await makeResearchArchive()));
    await expect(createAnnotatedResearchArchive(source, [])).rejects.toThrow(/at least one/);
    const draft = initialDraft(source, source.records.recordings[0]);
    await expect(createAnnotatedResearchArchive(source, [{ ...draft, sourceManifestSha256: 'b'.repeat(64) }])).rejects.toThrow(/different source/);
  });

  it('preserves source code switching when applying a draft saved before that review field existed', async () => {
    const source = await loadResearchDataset(archiveInput('pilot.zip', await makeResearchArchive()));
    const draft = initialDraft(source, source.records.recordings[0], new Date('2026-10-15T10:00:00.000Z'));
    const { codeSwitchingStatus: _removed, ...legacyDraft } = draft;
    const ids = ['61f523b2-2db8-4f59-82e9-e70b182656f1', '71f523b2-2db8-4f59-82e9-e70b182656f1'];
    const output = await createAnnotatedResearchArchive(source, [{ ...legacyDraft, verbatimText: 'Transcription.' }], {
      now: new Date('2026-10-15T11:00:00.000Z'),
      newId: () => ids.shift() ?? crypto.randomUUID(),
    });
    const verified = await loadResearchDataset(archiveInput(output.fileName, output.bytes));
    expect(verified.records.recordings[0].code_switching_status).toBe('present');
  });

  it('exports a Mashi transcription without inventing Kingwana business labels', async () => {
    const source = await loadResearchDataset(archiveInput('mashi.zip', await makeResearchArchive(
      { schemaVersion: '1.4.0', databaseVersion: 8 },
      { project: { title: 'Mashi Community Speech Pilot', target_language: 'Shi', language_code: 'shr', language_variety: 'Mashi', research_domain: 'General speech transcription', annotation_profile: 'verbatim_transcription' } },
    )));
    const draft = {
      ...initialDraft(source, source.records.recordings[0], new Date('2026-10-22T10:00:00.000Z')),
      verbatimText: 'Mashi transcription entered by a human.',
      notes: 'Regional form noted by the annotator.',
      businessLabels: { ...initialDraft(source, source.records.recordings[0]).businessLabels, transactionIntent: 'record_sale' as const },
    };
    const ids = ['81f523b2-2db8-4f59-82e9-e70b182656f1', '91f523b2-2db8-4f59-82e9-e70b182656f1'];
    const output = await createAnnotatedResearchArchive(source, [draft], {
      now: new Date('2026-10-22T11:00:00.000Z'),
      newId: () => ids.shift() ?? crypto.randomUUID(),
    });
    const verified = await loadResearchDataset(archiveInput(output.fileName, output.bytes));
    expect(verified.records.project).toMatchObject({ language_code: 'shr', annotation_profile: 'verbatim_transcription' });
    expect(verified.records.transcriptions[0]).toMatchObject({ verbatim_text: draft.verbatimText, notes: draft.notes, source: 'human' });
    expect(verified.records.annotations).toEqual([]);
  });
});
