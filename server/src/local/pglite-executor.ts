import type { PGlite } from '@electric-sql/pglite';

import type { SqlExecutor } from '../database/neon';

/** Runs the real repositories' SQL on a local PGlite database. */
export function createPgliteExecutor(database: PGlite): SqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<Row[]> {
      const result = await database.query<Row>(sql, [...values]);
      return result.rows;
    },
  };
}
