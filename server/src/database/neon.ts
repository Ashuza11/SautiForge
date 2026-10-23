import { neon } from '@neondatabase/serverless';

export interface SqlExecutor {
  query<Row extends Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<Row[]>;
}

export function createNeonExecutor(databaseUrl: string): SqlExecutor {
  const client = neon(databaseUrl);
  return {
    async query<Row extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []): Promise<Row[]> {
      const rows = await client.query(sql, [...values]);
      return rows as Row[];
    },
  };
}
