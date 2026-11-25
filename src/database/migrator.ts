import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { query, withTransaction } from '../config/database';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');

export async function runMigrations(): Promise<string[]> {
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const appliedRows = await query<{ filename: string }>('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedRows.rows.map((row) => row.filename));

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });

    newlyApplied.push(file);
  }

  return newlyApplied;
}
