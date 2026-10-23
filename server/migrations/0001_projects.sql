CREATE TABLE projects (
  id uuid PRIMARY KEY,
  title varchar(160) NOT NULL,
  description varchar(2000) NOT NULL DEFAULT '',
  target_language varchar(120) NOT NULL,
  language_code varchar(3) NOT NULL CHECK (language_code ~ '^[a-z]{3}$'),
  language_variety varchar(120) NOT NULL,
  research_domain varchar(160) NOT NULL,
  collection_location varchar(160) NOT NULL,
  protocol_version varchar(40) NOT NULL,
  annotation_profile varchar(40) NOT NULL CHECK (annotation_profile IN ('business_transaction', 'verbatim_transcription')),
  status varchar(20) NOT NULL CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE INDEX projects_status_title_idx ON projects (status, title);
