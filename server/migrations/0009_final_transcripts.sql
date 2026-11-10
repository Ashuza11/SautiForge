-- The final text of a clip is a separate, versioned record. Volunteer answers are never changed.
CREATE TABLE final_transcripts (
  id uuid PRIMARY KEY,
  clip_id uuid NOT NULL REFERENCES clips(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  decision varchar(12) NOT NULL CHECK (decision IN ('approved', 'excluded')),
  transcript_text varchar(1000),
  chosen_submission_id uuid REFERENCES submissions(id) ON DELETE RESTRICT,
  note varchar(500) NOT NULL DEFAULT '',
  created_by varchar(80) NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (clip_id, version),
  CHECK (
    (decision = 'approved' AND transcript_text IS NOT NULL AND char_length(btrim(transcript_text)) > 0) OR
    (decision = 'excluded' AND transcript_text IS NULL)
  )
);

CREATE INDEX final_transcripts_clip_idx ON final_transcripts (clip_id, version DESC);

-- A decision is replaced by adding a new version, never by editing. One line so the migration runner splits safely.
CREATE FUNCTION final_transcripts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Final transcripts are append-only.'; END $$;

CREATE TRIGGER final_transcripts_no_change BEFORE UPDATE OR DELETE ON final_transcripts FOR EACH ROW EXECUTE FUNCTION final_transcripts_append_only();
