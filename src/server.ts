import { createApp } from './app';
import { closePool } from './config/database';
import { env } from './config/env';
import { isFirebaseConfigured } from './config/firebase';

function main(): void {
  if (!isFirebaseConfigured()) {
    console.warn(
      '[server] Firebase credentials are missing. Message endpoints will fail until ' +
        'FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are set.',
    );
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    console.log(`[server] Swagger UI: http://localhost:${env.PORT}/api-docs`);
  });

  const shutdown = (signal: string): void => {
    console.log(`[server] received ${signal}, shutting down`);
    server.close(() => {
      closePool()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown startup error';
  console.error('[server] failed to start:', message);
  process.exit(1);
}
