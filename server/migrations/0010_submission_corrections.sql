-- A volunteer writes what they hear, exactly. An optional second note carries the form they think is correct, so the
-- spoken words are never replaced by the expected ones.
ALTER TABLE submissions ADD COLUMN correction_text varchar(1000);

ALTER TABLE submissions ADD CONSTRAINT submissions_correction_check CHECK (correction_text IS NULL OR (kind = 'transcript' AND char_length(btrim(correction_text)) > 0));
