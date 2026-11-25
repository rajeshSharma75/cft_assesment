import { createHash, randomUUID } from 'crypto';
import {
  DocumentReference,
  DocumentSnapshot,
  FieldPath,
  FieldValue,
  Firestore,
  Timestamp,
} from 'firebase-admin/firestore';
import { getFirestoreDb } from '../../config/firebase';
import { LastSeenPosition, MessagePage, MessageRecord, ReadReceipt } from '../../types';
import { AppError, conflict, notFound, serviceUnavailable } from '../../utils/app-error';
import { MessageCursor } from '../../utils/cursor';
import { CreateMessageInput, MessageStore } from './message.store';

const CHATS = 'chats';
const MESSAGES = 'messages';
const MEMBERS = 'members';
const RECEIPTS = 'receipts';

function firestoreCode(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code: unknown }).code;
  }
  return undefined;
}

function rethrowFirestoreError(error: unknown): never {
  if (error instanceof AppError) throw error;

  // Code 5 (NOT_FOUND) at this level means the configured database or project
  // does not exist, not that a message document is missing. Document-level
  // misses are handled explicitly by the callers.
  console.error(
    '[firestore] operation failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  throw serviceUnavailable('Message storage is temporarily unavailable');
}

function readTimestamp(value: unknown, fallback: Date | null = null): Date | null {
  return value instanceof Timestamp ? value.toDate() : fallback;
}

function toMessageRecord(chatId: string, snapshot: DocumentSnapshot): MessageRecord {
  const data = snapshot.data() ?? {};
  const createdAt = readTimestamp(data.createdAt) ?? new Date(0);

  return {
    id: snapshot.id,
    chatId,
    senderId: String(data.senderId ?? ''),
    text: typeof data.text === 'string' ? data.text : null,
    isDeleted: data.isDeleted === true,
    createdAt,
    editedAt: readTimestamp(data.editedAt, null),
    deletedAt: readTimestamp(data.deletedAt, null),
  };
}

function compareTimestamps(left: Timestamp, right: Timestamp): number {
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  if (left.nanoseconds !== right.nanoseconds) return left.nanoseconds < right.nanoseconds ? -1 : 1;
  return 0;
}

function idempotentMessageId(chatId: string, idempotencyKey: string): string {
  const digest = createHash('sha256').update(`${chatId}:${idempotencyKey}`, 'utf8').digest('hex');
  return `idem_${digest.slice(0, 40)}`;
}

export class FirestoreMessageStore implements MessageStore {
  private firestore: Firestore | null;

  constructor(firestore?: Firestore) {
    this.firestore = firestore ?? null;
  }

  /** Resolved on first use so the API can boot without Firebase credentials. */
  private get db(): Firestore {
    if (!this.firestore) this.firestore = getFirestoreDb();
    return this.firestore;
  }

  private messagesCollection(chatId: string) {
    return this.db.collection(CHATS).doc(chatId).collection(MESSAGES);
  }

  private messageDoc(chatId: string, messageId: string): DocumentReference {
    return this.messagesCollection(chatId).doc(messageId);
  }

  private memberDoc(chatId: string, userId: string): DocumentReference {
    return this.db.collection(CHATS).doc(chatId).collection(MEMBERS).doc(userId);
  }

  async createMessage(input: CreateMessageInput): Promise<MessageRecord> {
    try {
      const messageId = input.idempotencyKey
        ? idempotentMessageId(input.chatId, input.idempotencyKey)
        : randomUUID();
      const ref = this.messageDoc(input.chatId, messageId);

      try {
        await ref.create({
          senderId: input.senderId,
          text: input.text,
          isDeleted: false,
          createdAt: FieldValue.serverTimestamp(),
          editedAt: null,
          deletedAt: null,
        });
      } catch (error) {
        // A repeated idempotency key resolves to the previously stored message.
        if (firestoreCode(error) === 6) {
          const existing = await ref.get();
          if (existing.exists) return toMessageRecord(input.chatId, existing);
        }
        throw error;
      }

      const saved = await ref.get();
      if (!saved.exists) throw new Error('Message document missing immediately after create');
      return toMessageRecord(input.chatId, saved);
    } catch (error) {
      rethrowFirestoreError(error);
    }
  }

  async getMessage(chatId: string, messageId: string): Promise<MessageRecord | null> {
    try {
      const snapshot = await this.messageDoc(chatId, messageId).get();
      return snapshot.exists ? toMessageRecord(chatId, snapshot) : null;
    } catch (error) {
      rethrowFirestoreError(error);
    }
  }

  async listMessages(
    chatId: string,
    limit: number,
    cursor: MessageCursor | null,
  ): Promise<MessagePage> {
    try {
      let query = this.messagesCollection(chatId)
        .orderBy('createdAt', 'asc')
        .orderBy(FieldPath.documentId(), 'asc');

      if (cursor) {
        query = query.startAfter(
          new Timestamp(cursor.seconds, cursor.nanoseconds),
          cursor.messageId,
        );
      }

      // Fetch one extra document to detect whether another page exists.
      const snapshot = await query.limit(limit + 1).get();
      const docs = snapshot.docs;
      const hasMore = docs.length > limit;
      const pageDocs = hasMore ? docs.slice(0, limit) : docs;

      const messages = pageDocs.map((doc) => toMessageRecord(chatId, doc));

      let nextCursor: MessageCursor | null = null;
      if (hasMore && pageDocs.length > 0) {
        const last = pageDocs[pageDocs.length - 1];
        const createdAt = last?.get('createdAt');
        if (last && createdAt instanceof Timestamp) {
          nextCursor = {
            seconds: createdAt.seconds,
            nanoseconds: createdAt.nanoseconds,
            messageId: last.id,
          };
        }
      }

      return { messages, hasMore, nextCursor };
    } catch (error) {
      rethrowFirestoreError(error);
    }
  }

  async markMessageRead(
    chatId: string,
    messageId: string,
    userId: string,
  ): Promise<ReadReceipt> {
    try {
      const messageRef = this.messageDoc(chatId, messageId);
      const receiptRef = messageRef.collection(RECEIPTS).doc(userId);

      await this.db.runTransaction(async (transaction) => {
        const messageSnapshot = await transaction.get(messageRef);
        if (!messageSnapshot.exists) throw notFound('Message not found');

        const receiptSnapshot = await transaction.get(receiptRef);
        // Idempotent: never overwrite the original read timestamp.
        if (receiptSnapshot.exists) return;

        transaction.set(receiptRef, {
          userId,
          status: 'READ',
          readAt: FieldValue.serverTimestamp(),
        });
      });

      const saved = await receiptRef.get();
      return {
        status: 'READ',
        readAt: readTimestamp(saved.get('readAt'), new Date()) ?? new Date(),
      };
    } catch (error) {
      rethrowFirestoreError(error);
    }
  }

  async setLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenPosition> {
    try {
      const messageRef = this.messageDoc(chatId, messageId);
      const memberRef = this.memberDoc(chatId, userId);

      await this.db.runTransaction(async (transaction) => {
        const messageSnapshot = await transaction.get(messageRef);
        if (!messageSnapshot.exists) throw notFound('Message not found');

        const messageCreatedAt = messageSnapshot.get('createdAt');
        if (!(messageCreatedAt instanceof Timestamp)) {
          throw serviceUnavailable('Message ordering timestamp is not available yet');
        }

        const memberSnapshot = await transaction.get(memberRef);
        if (memberSnapshot.exists) {
          const existingCreatedAt = memberSnapshot.get('lastSeenMessageCreatedAt');
          const existingMessageId = memberSnapshot.get('lastSeenMessageId');

          if (existingCreatedAt instanceof Timestamp) {
            const comparison = compareTimestamps(messageCreatedAt, existingCreatedAt);
            const samePosition =
              comparison === 0 && typeof existingMessageId === 'string'
                ? messageId.localeCompare(existingMessageId)
                : comparison;

            // Never move the last-seen position backwards.
            if (samePosition <= 0) return;
          }
        }

        transaction.set(
          memberRef,
          {
            lastSeenMessageId: messageId,
            lastSeenMessageCreatedAt: messageCreatedAt,
            lastSeenAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      });

      const saved = await memberRef.get();
      return {
        lastSeenMessageId: String(saved.get('lastSeenMessageId') ?? messageId),
        lastSeenAt: readTimestamp(saved.get('lastSeenAt'), new Date()) ?? new Date(),
      };
    } catch (error) {
      rethrowFirestoreError(error);
    }
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<MessageRecord> {
    try {
      const ref = this.messageDoc(chatId, messageId);

      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw notFound('Message not found');
        if (snapshot.get('isDeleted') === true) {
          throw conflict('Deleted messages cannot be edited');
        }

        transaction.update(ref, {
          text,
          editedAt: FieldValue.serverTimestamp(),
        });
      });

      const saved = await ref.get();
      return toMessageRecord(chatId, saved);
    } catch (error) {
      rethrowFirestoreError(error);
    }
  }

  async deleteMessage(chatId: string, messageId: string): Promise<MessageRecord> {
    try {
      const ref = this.messageDoc(chatId, messageId);

      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw notFound('Message not found');

        // Deleting twice is a no-op and preserves the original deletedAt.
        if (snapshot.get('isDeleted') === true) return;

        transaction.update(ref, {
          text: null,
          isDeleted: true,
          deletedAt: FieldValue.serverTimestamp(),
        });
      });

      const saved = await ref.get();
      return toMessageRecord(chatId, saved);
    } catch (error) {
      rethrowFirestoreError(error);
    }
  }
}

export function createFirestoreMessageStore(): MessageStore {
  return new FirestoreMessageStore();
}
