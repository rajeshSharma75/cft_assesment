import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment schema. Every variable that the application cannot run without
 * is validated here so that misconfiguration fails fast at startup instead of
 * surfacing as a confusing runtime error later.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Optional schema override. The test suite sets this to "chat_test" so it can
  // run against the same database without touching the application's tables.
  DATABASE_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/, 'DATABASE_SCHEMA must be a lowercase PostgreSQL identifier')
    .optional(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long'),
  JWT_EXPIRES_IN: z.string().default('1d'),

  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  // Firestore database to use. Projects created with a named database (e.g.
  // "default") instead of the implicit "(default)" database must set this.
  FIRESTORE_DATABASE_ID: z.string().min(1).default('(default)'),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration -> ${details}`);
  }

  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';
