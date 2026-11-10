-- A clip is now one FLAC file: the master that volunteers also play. The Opus copy is optional,
-- and the audio-sample hash is optional because browser uploads do not know it.
ALTER TABLE clip_audio_files DROP CONSTRAINT clip_audio_files_format_check;
ALTER TABLE clip_audio_files
  ADD CONSTRAINT clip_audio_files_format_check CHECK (
    (variant = 'master' AND content_type = 'audio/flac') OR
    (variant = 'listening' AND content_type = 'audio/ogg')
  ) NOT VALID;
