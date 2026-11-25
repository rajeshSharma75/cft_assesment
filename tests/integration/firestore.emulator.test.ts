import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../../src/config/firebase';
import { FirestoreMessageStore } from '../../src/modules/chats/firestore-message.store';
import { AppError } from '../../src/utils/app-error';
import { USER_1, USER_2 } from '../helpers/database';

/**
 * Real Firestore integration tests. They are skipped unless a Firebase
 * Emulator Suite instance is reachable, so `npm test` works on a machine
 * without Java or emulator credentials:
 *
 *   npx firebase-tools emulators:start --only firestore --project demo-chat
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npm run test -- firestore.emulator
 */
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulatorHost ? describe : describe.skip;

if (!emulatorHost) {
  console.warn(
    '[tests] FIRESTORE_EMULATOR_HOST is not set - skipping Firestore emulator integration tests.',
  );
}

describeEmulator('FirestoreMessageStore (emulator)', () => {
  let db: Firestore;
  let store: FirestoreMessageStore;
  const chatIds: string[] = [];

  function newChatId(): string {
    const chatId = randomUUID();
    chatIds.push(chatId);
    return chatId;
  }

  beforeAll(() => {
    db = getFirestoreDb();
    store = new FirestoreMessageStore(db);
  });

  afterAll(async () => {
    for (const chatId of chatIds) {
      await db.recursiveDelete(db.collection('chats').doc(chatId));
    }
  });

  it('stores a message with a server timestamp', async () => {
    const chatId = newChatId();
    const message = await store.createMessage({ chatId, senderId: USER_1, text: 'hello' });

    expect(message.id).toEqual(expect.any(String));
    expect(message.senderId).toBe(USER_1);
    expect(message.text).toBe('hello');
    expect(message.isDeleted).toBe(false);
    expect(message.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('orders messages chronologically and paginates with a cursor', async () => {
    const chatId = newChatId();
    for (let index = 0; index < 5; index += 1) {
      await store.createMessage({ chatId, senderId: USER_1, text: `m${index}` });
    }

    const firstPage = await store.listMessages(chatId, 2, null);
    expect(firstPage.messages.map((message) => message.text)).toEqual(['m0', 'm1']);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await store.listMessages(chatId, 2, firstPage.nextCursor);
    expect(secondPage.messages.map((message) => message.text)).toEqual(['m2', 'm3']);

    const thirdPage = await store.listMessages(chatId, 2, secondPage.nextCursor);
    expect(thirdPage.messages.map((message) => message.text)).toEqual(['m4']);
    expect(thirdPage.hasMore).toBe(false);
    expect(thirdPage.nextCursor).toBeNull();
  });

  it('deduplicates idempotent sends', async () => {
    const chatId = newChatId();
    const input = { chatId, senderId: USER_1, text: 'once', idempotencyKey: 'key-1' };

    const first = await store.createMessage(input);
    const second = await store.createMessage(input);

    expect(second.id).toBe(first.id);
    expect(second.createdAt.toISOString()).toBe(first.createdAt.toISOString());
  });

  it('keeps the first read receipt timestamp', async () => {
    const chatId = newChatId();
    const message = await store.createMessage({ chatId, senderId: USER_1, text: 'read me' });

    const first = await store.markMessageRead(chatId, message.id, USER_2);
    const second = await store.markMessageRead(chatId, message.id, USER_2);

    expect(first.status).toBe('READ');
    expect(second.readAt.toISOString()).toBe(first.readAt.toISOString());
  });

  it('never moves last seen backwards', async () => {
    const chatId = newChatId();
    const first = await store.createMessage({ chatId, senderId: USER_1, text: 'first' });
    const second = await store.createMessage({ chatId, senderId: USER_1, text: 'second' });

    await store.setLastSeen(chatId, USER_2, second.id);
    const result = await store.setLastSeen(chatId, USER_2, first.id);

    expect(result.lastSeenMessageId).toBe(second.id);
  });

  it('edits a message, preserving createdAt and setting editedAt', async () => {
    const chatId = newChatId();
    const message = await store.createMessage({ chatId, senderId: USER_1, text: 'v1' });

    const edited = await store.editMessage(chatId, message.id, 'v2');

    expect(edited.text).toBe('v2');
    expect(edited.createdAt.toISOString()).toBe(message.createdAt.toISOString());
    expect(edited.editedAt).not.toBeNull();
  });

  it('soft deletes a message and blocks edits afterwards', async () => {
    const chatId = newChatId();
    const message = await store.createMessage({ chatId, senderId: USER_1, text: 'bye' });

    const deleted = await store.deleteMessage(chatId, message.id);
    expect(deleted.text).toBeNull();
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.deletedAt).not.toBeNull();

    await expect(store.editMessage(chatId, message.id, 'back')).rejects.toBeInstanceOf(AppError);
  });

  it('returns null for a missing message', async () => {
    const chatId = newChatId();
    expect(await store.getMessage(chatId, 'missing')).toBeNull();
  });
});
