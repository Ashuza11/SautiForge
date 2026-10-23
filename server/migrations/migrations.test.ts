import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('community service database migrations', () => {
  it('creates reusable projects with language, annotation profile, status, and timezone-aware timestamps', async () => {
    const sql = await readFile(new URL('./0001_projects.sql', import.meta.url), 'utf8');
    expect(sql).toContain('id uuid PRIMARY KEY');
    expect(sql).toContain("language_code ~ '^[a-z]{3}$'");
    expect(sql).toContain("annotation_profile IN ('business_transaction', 'verbatim_transcription')");
    expect(sql).toContain("status IN ('active', 'archived')");
    expect(sql.match(/timestamptz/g)).toHaveLength(2);
  });

  it('does not create source, task, participant, or annotation tables before their permission models exist', async () => {
    const sql = (await readFile(new URL('./0001_projects.sql', import.meta.url), 'utf8')).toLowerCase();
    expect(sql).not.toMatch(/create table (sources|tasks|participants|annotations)/);
  });
});
