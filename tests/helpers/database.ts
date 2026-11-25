import { Client } from 'pg';
import { query } from '../../src/config/database';
import { runMigrations } from '../../src/database/migrator';

const TEST_SCHEMA = process.env.DATABASE_SCHEMA ?? 'chat_test';

export const TEST_USERS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Aarav Sharma',
    email: 'aarav.sharma@example.com',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Priya Patel',
    email: 'priya.patel@example.com',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Rahul Verma',
    email: 'rahul.verma@example.com',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Sneha Iyer',
    email: 'sneha.iyer@example.com',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Vikram Singh',
    email: 'vikram.singh@example.com',
  },
] as const;

export const USER_1 = TEST_USERS[0].id;
export const USER_2 = TEST_USERS[1].id;
export const USER_3 = TEST_USERS[2].id;
export const USER_4 = TEST_USERS[3].id;
export const USER_5 = TEST_USERS[4].id;

let migrated = false;

/**
 * The suite shares the application's database, so it works inside its own
 * schema. Creating it up front is what keeps migrations and TRUNCATEs away
 * from the application's tables in "public".
 */
async function ensureTestSchema(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
  } finally {
    await client.end();
  }
}

/** Applies migrations once per test run, inside the isolated test schema. */
export async function prepareTestDatabase(): Promise<void> {
  if (migrated) return;

  await ensureTestSchema();

  const result = await query<{ schema: string | null }>('SELECT current_schema() AS schema');
  if (result.rows[0]?.schema !== TEST_SCHEMA) {
    throw new Error(
      `Refusing to run tests: expected schema "${TEST_SCHEMA}" but the connection is using ` +
        `"${result.rows[0]?.schema}". Nothing was migrated or truncated.`,
    );
  }

  await runMigrations();
  migrated = true;
}

/** Removes all rows so each test starts from a known state. */
export async function resetDatabase(): Promise<void> {
  await prepareTestDatabase();
  await query('TRUNCATE TABLE chat_members, chats, users CASCADE');
}

export async function seedTestUsers(): Promise<void> {
  for (const user of TEST_USERS) {
    await query(
      `INSERT INTO users (id, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
      [user.id, user.name, user.email],
    );
  }
}

export async function resetAndSeed(): Promise<void> {
  await resetDatabase();
  await seedTestUsers();
}
