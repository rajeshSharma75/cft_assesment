import { closePool } from '../src/config/database';
import { runMigrations } from '../src/database/migrator';

async function main(): Promise<void> {
  const applied = await runMigrations();

  if (applied.length === 0) {
    console.log('[migrate] database is already up to date');
  } else {
    for (const file of applied) console.log(`[migrate] applied ${file}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('[migrate] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
