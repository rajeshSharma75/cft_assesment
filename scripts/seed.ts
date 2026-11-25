import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { closePool, query } from '../src/config/database';
import { UserRow } from '../src/types';

const SEED_FILE = path.resolve(__dirname, '../database/seeds/001_users.sql');

async function main(): Promise<void> {
  const sql = await readFile(SEED_FILE, 'utf8');
  await query(sql);

  const users = await query<Pick<UserRow, 'id' | 'name' | 'email'>>(
    'SELECT id, name, email FROM users ORDER BY created_at ASC, email ASC',
  );

  console.log(`[seed] ${users.rowCount} sample users available:`);
  for (const user of users.rows) {
    console.log(`  ${user.id}  ${user.name} <${user.email}>`);
  }
  console.log('\n[seed] Generate a development token with:');
  console.log('  npm run token -- aarav.sharma@example.com');
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
