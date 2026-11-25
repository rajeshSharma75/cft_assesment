import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

// Load the same .env the application uses: the project has a single database,
// so tests connect to DATABASE_URL as well.
if (existsSync('.env')) dotenv.config();

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-value-please-change';
process.env.JWT_EXPIRES_IN = '1h';

// Tests never use the application's tables. They create and use an isolated
// schema (see tests/helpers/database.ts) inside the same database, so no
// separate test database is required and production rows are never truncated.
process.env.DATABASE_SCHEMA = 'chat_test';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at your PostgreSQL database.',
  );
}

// Firebase is never initialised for API tests; an in-memory MessageStore is
// injected. The optional emulator suite uses FIRESTORE_EMULATOR_HOST when set.
