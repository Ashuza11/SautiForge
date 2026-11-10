-- One stored file per clip role: a lossless FLAC master and a small Opus listening copy.
-- pcm_sha256_hex is the SHA-256 of the 16-bit PCM samples the master was encoded from (WAV headers vary).
-- Constraints are NOT VALID so any pre-release rows in a local sandbox are left untouched.
ALTER TABLE clip_audio_files
  ADD COLUMN derived_from varchar(16) NOT NULL DEFAULT 'cleaned' CHECK (derived_from IN ('original', 'cleaned')),
  ADD COLUMN pcm_sha256_hex char(64) CHECK (pcm_sha256_hex IS NULL OR pcm_sha256_hex ~ '^[a-f0-9]{64}$');

ALTER TABLE clip_audio_files DROP CONSTRAINT clip_audio_files_variant_check;
ALTER TABLE clip_audio_files DROP CONSTRAINT clip_audio_files_content_type_check;

ALTER TABLE clip_audio_files
  ADD CONSTRAINT clip_audio_files_role_check CHECK (variant IN ('master', 'listening')) NOT VALID;
ALTER TABLE clip_audio_files
  ADD CONSTRAINT clip_audio_files_format_check CHECK (
    (variant = 'master' AND content_type = 'audio/flac' AND pcm_sha256_hex IS NOT NULL) OR
    (variant = 'listening' AND content_type = 'audio/ogg')
  ) NOT VALID;
