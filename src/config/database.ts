import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';

/**
 * Single connection pool for the whole process. Every repository goes through
 * `query` or `withTransaction`; nothing opens ad-hoc clients.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Set by the test suite so every connection starts in the isolated schema and
  // the application's tables in "public" are never touched.
  ...(env.DATABASE_SCHEMA ? { options: `-c search_path=${env.DATABASE_SCHEMA},public` } : {}),
});

pool.on('error', (error) => {
  // Never log connection strings or credentials, only the driver message.
  console.error('[db] unexpected idle client error:', error.message);
});

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/**
 * Runs `fn` inside a single PostgreSQL transaction, committing on success and
 * rolling back on any thrown error.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures; the original error is the useful one.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export async function checkDatabaseConnection(): Promise<boolean> {
  const result = await query<{ ok: number }>('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}
