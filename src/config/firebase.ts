import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { env, isTest } from './env';

let firebaseApp: App | null = null;
let firestore: Firestore | null = null;

interface FirebaseCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export function isFirebaseConfigured(): boolean {
  const hasEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
  const hasServiceAccount = Boolean(
    env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY,
  );
  return hasEmulator || hasServiceAccount;
}

function readCredentials(): FirebaseCredentials {
  const missing: string[] = [];
  if (!env.FIREBASE_PROJECT_ID) missing.push('FIREBASE_PROJECT_ID');
  if (!env.FIREBASE_CLIENT_EMAIL) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!env.FIREBASE_PRIVATE_KEY) missing.push('FIREBASE_PRIVATE_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Firebase is not configured. Missing environment variables: ${missing.join(', ')}. ` +
        'See README.md > Getting the Firebase credentials (or set FIRESTORE_EMULATOR_HOST to use the emulator).',
    );
  }

  return {
    projectId: env.FIREBASE_PROJECT_ID as string,
    clientEmail: env.FIREBASE_CLIENT_EMAIL as string,
    // .env files store the key with literal "\n" sequences.
    privateKey: (env.FIREBASE_PRIVATE_KEY as string).replace(/\\n/g, '\n'),
  };
}

/**
 * Lazily initialises the Firebase Admin app so that tests and tooling can load
 * modules without any Firebase credentials being present.
 */
export function getFirebaseApp(): App {
  if (firebaseApp) return firebaseApp;

  const existing = getApps();
  if (existing.length > 0 && existing[0]) {
    firebaseApp = existing[0];
    return firebaseApp;
  }

  if (env.FIRESTORE_EMULATOR_HOST) {
    firebaseApp = initializeApp({
      projectId: env.FIREBASE_PROJECT_ID ?? 'demo-chat-backend',
    });
    return firebaseApp;
  }

  const credentials = readCredentials();
  firebaseApp = initializeApp({
    credential: cert({
      projectId: credentials.projectId,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
    }),
    projectId: credentials.projectId,
  });

  return firebaseApp;
}

export function getFirestoreDb(): Firestore {
  if (firestore) return firestore;

  if (isTest && !env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'Firestore is not available in the test environment. Inject an in-memory MessageStore instead.',
    );
  }

  firestore = getFirestore(getFirebaseApp(), env.FIRESTORE_DATABASE_ID);
  return firestore;
}
