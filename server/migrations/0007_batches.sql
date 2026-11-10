-- A batch is a small set of published clips shared with the community through one link.
CREATE TABLE batches (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL,
  title varchar(80) NOT NULL CHECK (char_length(btrim(title)) > 0),
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by varchar(80) NOT NULL,
  created_at timestamptz NOT NULL,
  closed_at timestamptz,
  FOREIGN KEY (source_id, project_id) REFERENCES sources(id, project_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'open' AND closed_at IS NULL) OR
    (status = 'closed' AND closed_at IS NOT NULL AND closed_at >= created_at)
  )
);

CREATE INDEX batches_source_created_idx ON batches (source_id, created_at);

CREATE TABLE batch_clips (
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  clip_id uuid NOT NULL REFERENCES clips(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 10),
  PRIMARY KEY (batch_id, clip_id),
  UNIQUE (batch_id, position)
);

CREATE INDEX batch_clips_clip_idx ON batch_clips (clip_id);
