CREATE TABLE clips (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL,
  rights_revision integer NOT NULL CHECK (rights_revision > 0),
  clip_key varchar(40) NOT NULL CHECK (clip_key ~ '^[A-Za-z0-9_-]{1,40}$'),
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL,
  trimmed_ms integer NOT NULL DEFAULT 0 CHECK (trimmed_ms >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 60000),
  speaker_role varchar(24) NOT NULL CHECK (speaker_role IN ('narrator', 'character', 'multiple', 'unknown')),
  speaker_name varchar(80),
  has_music boolean NOT NULL,
  tier varchar(16) NOT NULL CHECK (tier IN ('asr', 'asr_tts')),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  segmenter varchar(80),
  created_by varchar(80) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  published_at timestamptz,
  withdrawn_at timestamptz,
  UNIQUE (source_id, clip_key),
  UNIQUE (id, project_id),
  FOREIGN KEY (source_id, project_id) REFERENCES sources(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, rights_revision) REFERENCES source_rights_revisions(source_id, revision) ON DELETE RESTRICT,
  CHECK (end_ms > start_ms),
  CHECK (updated_at >= created_at),
  CHECK (tier = 'asr' OR has_music = false),
  CHECK (
    (status = 'draft' AND published_at IS NULL AND withdrawn_at IS NULL) OR
    (status = 'published' AND published_at IS NOT NULL AND withdrawn_at IS NULL) OR
    (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
  )
);

CREATE INDEX clips_project_status_idx ON clips (project_id, status, source_id, start_ms);

CREATE TABLE clip_audio_files (
  id uuid PRIMARY KEY,
  clip_id uuid NOT NULL REFERENCES clips(id) ON DELETE RESTRICT,
  variant varchar(24) NOT NULL CHECK (variant IN ('original', 'vocals_htdemucs')),
  object_key varchar(1024) NOT NULL UNIQUE,
  content_type varchar(40) NOT NULL CHECK (content_type = 'audio/wav'),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256_hex char(64) NOT NULL CHECK (sha256_hex ~ '^[a-f0-9]{64}$'),
  sample_rate integer NOT NULL CHECK (sample_rate BETWEEN 8000 AND 96000),
  duration_ms integer NOT NULL CHECK (duration_ms > 0),
  status varchar(32) NOT NULL CHECK (status IN ('upload_pending', 'verified', 'verification_failed')),
  verification_error varchar(80),
  upload_expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (clip_id, variant),
  CHECK (updated_at >= created_at),
  CHECK (upload_expires_at > created_at),
  CHECK (
    (status = 'verified' AND verified_at IS NOT NULL AND verification_error IS NULL) OR
    (status = 'verification_failed' AND verified_at IS NULL AND verification_error IS NOT NULL) OR
    (status = 'upload_pending' AND verified_at IS NULL AND verification_error IS NULL)
  )
);

CREATE INDEX clip_audio_files_pending_expiry_idx ON clip_audio_files (upload_expires_at) WHERE status = 'upload_pending';
