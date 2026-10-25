CREATE UNIQUE INDEX sources_id_project_unique_idx ON sources (id, project_id);

CREATE TABLE source_media (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL,
  rights_revision integer NOT NULL CHECK (rights_revision > 0),
  object_key varchar(1024) NOT NULL UNIQUE,
  client_filename varchar(255) NOT NULL,
  content_type varchar(120) NOT NULL CHECK (content_type ~ '^(audio|video)/[a-z0-9][a-z0-9.+-]*$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5368709120),
  sha256_hex char(64) NOT NULL CHECK (sha256_hex ~ '^[a-f0-9]{64}$'),
  status varchar(32) NOT NULL CHECK (status IN ('upload_pending', 'verified', 'verification_failed')),
  verification_error varchar(80),
  upload_expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_by varchar(80) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (source_id, project_id) REFERENCES sources(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, rights_revision) REFERENCES source_rights_revisions(source_id, revision) ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK (upload_expires_at > created_at),
  CHECK (verified_at IS NULL OR verified_at >= created_at),
  CHECK (
    (status = 'verified' AND verified_at IS NOT NULL AND verification_error IS NULL) OR
    (status = 'verification_failed' AND verified_at IS NULL AND verification_error IS NOT NULL) OR
    (status = 'upload_pending' AND verified_at IS NULL AND verification_error IS NULL)
  )
);

CREATE INDEX source_media_source_created_idx ON source_media (source_id, created_at, id);
CREATE INDEX source_media_pending_expiry_idx ON source_media (upload_expires_at) WHERE status = 'upload_pending';
