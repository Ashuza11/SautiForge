import { describe, expect, it, vi } from 'vitest';

import { SQLiteTranscriptionRepository } from './sqlite-transcription-repository';

vi.mock('@/domain/common', () => ({
  newId: () => 'f113147b-c726-444c-a454-94f0ee1d1b6c',
  nowIso: () => '2026-10-13T14:00:00.000+02:00',
}));

describe('transcription context persistence', () => {
  it('writes and reads editable scenario and example context with the revision', async () => {
    const runAsync = vi.fn().mockResolvedValue({ changes: 1 });
    const transaction = { getFirstAsync: vi.fn().mockResolvedValue(null), runAsync };
    const saved = {
      id: 'f113147b-c726-444c-a454-94f0ee1d1b6c',
      recording_id: 'de0a9676-92cc-4b18-997a-3fafce18b700',
      verbatim_text: 'Nimeuzisha unités mbili',
      normalized_text: null,
      scenario_context: 'Recording a sale',
      elicitation_prompt_context: 'Uuzishe unités mbili',
      language_tags_json: '["kingwana"]',
      notes: null,
      source: 'human',
      revision_number: 1,
      supersedes_id: null,
      created_at: '2026-10-13T14:00:00.000+02:00',
      created_by: 'researcher',
    };
    const database = {
      withExclusiveTransactionAsync: vi.fn(async (work: (value: typeof transaction) => Promise<void>) => work(transaction)),
      getFirstAsync: vi.fn().mockResolvedValue(saved),
    };
    const repository = new SQLiteTranscriptionRepository(database as never);

    const revision = await repository.createRevision(saved.recording_id, {
      verbatimText: saved.verbatim_text,
      normalizedText: null,
      scenarioContext: saved.scenario_context,
      elicitationPromptContext: saved.elicitation_prompt_context,
      languageTags: ['kingwana'],
      notes: null,
      createdBy: saved.created_by,
    });

    expect(revision.scenarioContext).toBe(saved.scenario_context);
    expect(revision.elicitationPromptContext).toBe(saved.elicitation_prompt_context);
    expect(runAsync).toHaveBeenCalledOnce();
    expect(runAsync.mock.calls[0]?.[0]).toContain('scenario_context, elicitation_prompt_context');
    expect(runAsync.mock.calls[0]?.slice(5, 7)).toEqual([saved.scenario_context, saved.elicitation_prompt_context]);
  });
});
