CREATE TABLE sources (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_type varchar(40) NOT NULL CHECK (source_type IN ('youtube_reference', 'external_url', 'authorized_upload', 'creator_provided', 'sautiforge_recording')),
  title varchar(240) NOT NULL,
  original_url varchar(2000),
  creator varchar(240),
  source_date date,
  duration_ms bigint CHECK (duration_ms > 0 AND duration_ms <= 86400000),
  external_reference varchar(240),
  language_verification varchar(40) NOT NULL CHECK (language_verification IN ('unverified', 'verified_target', 'mixed_target', 'wrong_language')),
  language_verified_by varchar(80),
  language_verification_notes varchar(2000) NOT NULL DEFAULT '',
  speaker_identification varchar(40) NOT NULL CHECK (speaker_identification IN ('not_assessed', 'unknown', 'partially_verified', 'verified')),
  speaker_notes varchar(2000) NOT NULL DEFAULT '',
  status varchar(40) NOT NULL CHECK (status IN ('candidate', 'language_unverified', 'permission_pending', 'approved', 'rejected', 'revoked')),
  rights_revision integer NOT NULL DEFAULT 0 CHECK (rights_revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at),
  CHECK (source_type NOT IN ('youtube_reference', 'external_url') OR original_url IS NOT NULL),
  CHECK (source_type <> 'sautiforge_recording' OR external_reference IS NOT NULL),
  CHECK (language_verification = 'unverified' OR language_verified_by IS NOT NULL)
);

CREATE INDEX sources_project_status_title_idx ON sources (project_id, status, title);

CREATE TABLE source_rights_revisions (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  rights_holder varchar(240),
  license varchar(240),
  permission_evidence varchar(2000),
  attribution_requirements varchar(2000),
  allow_internal_processing boolean NOT NULL,
  allow_volunteer_access boolean NOT NULL,
  allow_transcription boolean NOT NULL,
  allow_ml_research boolean NOT NULL,
  allow_public_distribution boolean NOT NULL,
  decision varchar(20) NOT NULL CHECK (decision IN ('pending', 'approved', 'rejected', 'revoked')),
  changed_by varchar(80) NOT NULL,
  change_reason varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (source_id, revision),
  CHECK (
    decision <> 'approved' OR (
      rights_holder IS NOT NULL AND btrim(rights_holder) <> '' AND
      permission_evidence IS NOT NULL AND btrim(permission_evidence) <> '' AND
      (allow_internal_processing OR allow_volunteer_access OR allow_transcription OR allow_ml_research OR allow_public_distribution)
    )
  ),
  CHECK (
    decision NOT IN ('rejected', 'revoked') OR NOT (
      allow_internal_processing OR allow_volunteer_access OR allow_transcription OR allow_ml_research OR allow_public_distribution
    )
  )
);

CREATE INDEX source_rights_source_revision_idx ON source_rights_revisions (source_id, revision DESC);
