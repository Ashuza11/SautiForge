import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { neon } from '@neondatabase/serverless';

import { parseServerConfig } from '../src/config';

const config = parseServerConfig(process.env);
const sql = neon(config.databaseUrl);
const migrationDirectory = path.resolve(import.meta.dirname, '../migrations');

await sql.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    sha256 char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const files = (await readdir(migrationDirectory))
  .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
  .sort();

for (const file of files) {
  const contents = await readFile(path.join(migrationDirectory, file), 'utf8');
  const checksum = createHash('sha256').update(contents).digest('hex');
  const existing = await sql.query('SELECT sha256 FROM schema_migrations WHERE name = $1', [file]) as { sha256: string }[];
  if (existing[0]) {
    if (existing[0].sha256 !== checksum) throw new Error(`Applied migration ${file} has changed.`);
    continue;
  }

  const statements = contents
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  await sql.transaction([
    ...statements.map((statement) => sql.query(statement)),
    sql.query('INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)', [file, checksum]),
  ]);
  console.log(`Applied ${file}`);
}
