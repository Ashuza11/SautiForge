-- Volunteers use a nickname, no account. Their answers are kept as raw, append-only submissions.
CREATE TABLE contributors (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  pseudonym varchar(40) NOT NULL CHECK (char_length(btrim(pseudonym)) BETWEEN 2 AND 40),
  created_at timestamptz NOT NULL
);

CREATE INDEX contributors_project_idx ON contributors (project_id);

CREATE TABLE submissions (
  id uuid PRIMARY KEY,
  clip_id uuid NOT NULL REFERENCES clips(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  contributor_id uuid NOT NULL REFERENCES contributors(id) ON DELETE RESTRICT,
  kind varchar(12) NOT NULL CHECK (kind IN ('transcript', 'skip')),
  transcript_text varchar(1000),
  created_at timestamptz NOT NULL,
  UNIQUE (clip_id, contributor_id),
  FOREIGN KEY (batch_id, clip_id) REFERENCES batch_clips(batch_id, clip_id) ON DELETE RESTRICT,
  CHECK (
    (kind = 'transcript' AND transcript_text IS NOT NULL AND char_length(btrim(transcript_text)) > 0) OR
    (kind = 'skip' AND transcript_text IS NULL)
  )
);

CREATE INDEX submissions_clip_kind_idx ON submissions (clip_id, kind);
CREATE INDEX submissions_batch_idx ON submissions (batch_id);

-- Answers are never edited or removed. The function body stays on one line so the migration runner can split statements safely.
CREATE FUNCTION submissions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Submissions are append-only.'; END $$;

CREATE TRIGGER submissions_no_change BEFORE UPDATE OR DELETE ON submissions FOR EACH ROW EXECUTE FUNCTION submissions_append_only();
