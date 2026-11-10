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

  it('adds project-scoped sources and append-only rights revisions with explicit use gates', async () => {
    const sql = await readFile(new URL('./0002_sources_and_rights.sql', import.meta.url), 'utf8');
    expect(sql).toContain('project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT');
    expect(sql).toContain('CREATE TABLE source_rights_revisions');
    expect(sql).toContain('language_verified_by varchar(80)');
    expect(sql).toContain('UNIQUE (source_id, revision)');
    expect(sql).toContain('allow_volunteer_access boolean NOT NULL');
    expect(sql).toContain('allow_ml_research boolean NOT NULL');
    expect(sql).toContain('allow_public_distribution boolean NOT NULL');
    expect(sql).toContain("decision IN ('pending', 'approved', 'rejected', 'revoked')");
  });

  it('does not add media, clips, or task tables before approved-source upload is implemented', async () => {
    const sql = (await readFile(new URL('./0002_sources_and_rights.sql', import.meta.url), 'utf8')).toLowerCase();
    expect(sql).not.toMatch(/create table (media|clips|tasks|annotations)/);
  });

  it('adds rights-bound source masters with immutable hashes and explicit verification states', async () => {
    const sql = await readFile(new URL('./0003_source_media.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE source_media');
    expect(sql).toContain('CREATE UNIQUE INDEX sources_id_project_unique_idx ON sources (id, project_id)');
    expect(sql).toContain('FOREIGN KEY (source_id, project_id) REFERENCES sources(id, project_id) ON DELETE RESTRICT');
    expect(sql).toContain('FOREIGN KEY (source_id, rights_revision) REFERENCES source_rights_revisions(source_id, revision) ON DELETE RESTRICT');
    expect(sql).toContain("content_type ~ '^(audio|video)/");
    expect(sql).toContain("sha256_hex ~ '^[a-f0-9]{64}$'");
    expect(sql).toContain("status IN ('upload_pending', 'verified', 'verification_failed')");
    expect(sql).toContain("status = 'verified' AND verified_at IS NOT NULL");
    expect(sql.toLowerCase()).not.toMatch(/create table (clips|tasks|annotations)/);
  });

  it('adds rights-bound clips with two verified audio variants and publish states', async () => {
    const sql = await readFile(new URL('./0004_clips.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE clips');
    expect(sql).toContain('FOREIGN KEY (source_id, project_id) REFERENCES sources(id, project_id) ON DELETE RESTRICT');
    expect(sql).toContain('FOREIGN KEY (source_id, rights_revision) REFERENCES source_rights_revisions(source_id, revision) ON DELETE RESTRICT');
    expect(sql).toContain('UNIQUE (source_id, clip_key)');
    expect(sql).toContain("speaker_role IN ('narrator', 'character', 'multiple', 'unknown')");
    expect(sql).toContain("tier IN ('asr', 'asr_tts')");
    expect(sql).toContain("CHECK (tier = 'asr' OR has_music = false)");
    expect(sql).toContain("status IN ('draft', 'published', 'withdrawn')");
    expect(sql).toContain('CREATE TABLE clip_audio_files');
    expect(sql).toContain("variant IN ('original', 'vocals_htdemucs')");
    expect(sql).toContain('UNIQUE (clip_id, variant)');
    expect(sql).toContain("sha256_hex ~ '^[a-f0-9]{64}$'");
    expect(sql).toContain("status IN ('upload_pending', 'verified', 'verification_failed')");
  });

  it('keeps transcripts and tasks out of the clip tables', async () => {
    const sql = (await readFile(new URL('./0004_clips.sql', import.meta.url), 'utf8')).toLowerCase();
    expect(sql).not.toMatch(/transcript|create table (batches|submissions|contributors)/);
  });

  it('stores a FLAC master and an Opus listening copy per clip and keeps the WAV hash for export', async () => {
    const sql = await readFile(new URL('./0005_clip_audio_formats.sql', import.meta.url), 'utf8');
    expect(sql).toContain("derived_from varchar(16) NOT NULL DEFAULT 'cleaned'");
    expect(sql).toContain('pcm_sha256_hex char(64)');
    expect(sql).toContain("variant IN ('master', 'listening')");
    expect(sql).toContain("content_type = 'audio/flac' AND pcm_sha256_hex IS NOT NULL");
    expect(sql).toContain("content_type = 'audio/ogg'");
    expect(sql.match(/\) NOT VALID;/g)).toHaveLength(2);
  });

  it('lets a clip be a single FLAC master', async () => {
    const sql = await readFile(new URL('./0006_single_flac_clips.sql', import.meta.url), 'utf8');
    expect(sql).toContain("variant = 'master' AND content_type = 'audio/flac'");
    expect(sql).not.toContain('pcm_sha256_hex IS NOT NULL');
    expect(sql).toContain(') NOT VALID;');
  });
});
