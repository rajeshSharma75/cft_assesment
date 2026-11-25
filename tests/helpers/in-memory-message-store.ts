import { createHash } from 'node:crypto';
import { LastSeenPosition, MessagePage, MessageRecord, ReadReceipt } from '../../src/types';
import { conflict, notFound } from '../../src/utils/app-error';
import { MessageCursor } from '../../src/utils/cursor';
import { CreateMessageInput, MessageStore } from '../../src/modules/chats/message.store';

interface LastSeenState {
  messageId: string;
  messageCreatedAt: Date;
  lastSeenAt: Date;
}

interface SeedMessageInput {
  id: string;
  senderId: string;
  text?: string;
  createdAt: Date;
  isDeleted?: boolean;
}

/**
 * Deterministic in-memory implementation of the Firestore contract. It mirrors
 * ordering, pagination, receipt idempotency and last-seen monotonicity so the
 * Express/Supertest tests can run without Firebase credentials or an emulator.
 */
export class InMemoryMessageStore implements MessageStore {
  private readonly messages = new Map<string, Map<string, MessageRecord>>();
  private readonly receipts = new Map<string, ReadReceipt>();
  private readonly lastSeen = new Map<string, LastSeenState>();
  private readonly idempotency = new Map<string, string>();
  private clock = Date.now();

  private tick(): Date {
    this.clock += 1;
    return new Date(this.clock);
  }

  private chatMessages(chatId: string): Map<string, MessageRecord> {
    let bucket = this.messages.get(chatId);
    if (!bucket) {
      bucket = new Map<string, MessageRecord>();
      this.messages.set(chatId, bucket);
    }
    return bucket;
  }

  async createMessage(input: CreateMessageInput): Promise<MessageRecord> {
    if (input.idempotencyKey) {
      const key = `${input.chatId}:${input.idempotencyKey}`;
      const existingId = this.idempotency.get(key);
      if (existingId) {
        const existing = this.chatMessages(input.chatId).get(existingId);
        if (existing) return { ...existing };
      }

      const digest = createHash('sha256').update(key).digest('hex').slice(0, 40);
      const id = `idem_${digest}`;
      const record = this.insert(input.chatId, id, input.senderId, input.text, this.tick());
      this.idempotency.set(key, id);
      return { ...record };
    }

    const id = `msg_${Math.random().toString(36).slice(2, 12)}`;
    return { ...this.insert(input.chatId, id, input.senderId, input.text, this.tick()) };
  }

  /** Test-only helper for ordering/pagination fixtures with explicit timestamps. */
  seedMessage(chatId: string, input: SeedMessageInput): MessageRecord {
    const record: MessageRecord = {
      id: input.id,
      chatId,
      senderId: input.senderId,
      text: input.isDeleted ? null : (input.text ?? 'seeded'),
      isDeleted: input.isDeleted ?? false,
      createdAt: input.createdAt,
      editedAt: null,
      deletedAt: input.isDeleted ? input.createdAt : null,
    };
    this.chatMessages(chatId).set(record.id, record);
    return { ...record };
  }

  async getMessage(chatId: string, messageId: string): Promise<MessageRecord | null> {
    const message = this.chatMessages(chatId).get(messageId);
    return message ? { ...message } : null;
  }

  async listMessages(
    chatId: string,
    limit: number,
    cursor: MessageCursor | null,
  ): Promise<MessagePage> {
    const ordered = [...this.chatMessages(chatId).values()].sort(compareRecords);

    const cursorMillis = cursor
      ? cursor.seconds * 1000 + Math.floor(cursor.nanoseconds / 1_000_000)
      : 0;

    const afterCursor = cursor
      ? ordered.filter((message) => {
          const millis = message.createdAt.getTime();
          if (millis !== cursorMillis) return millis > cursorMillis;
          return message.id > cursor.messageId;
        })
      : ordered;

    const page = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const last = page[page.length - 1];

    return {
      messages: page.map((message) => ({ ...message })),
      hasMore,
      nextCursor:
        hasMore && last
          ? {
              seconds: Math.floor(last.createdAt.getTime() / 1000),
              nanoseconds: (last.createdAt.getTime() % 1000) * 1_000_000,
              messageId: last.id,
            }
          : null,
    };
  }

  async markMessageRead(
    chatId: string,
    messageId: string,
    userId: string,
  ): Promise<ReadReceipt> {
    const message = this.chatMessages(chatId).get(messageId);
    if (!message) throw notFound('Message not found');

    const key = `${chatId}:${messageId}:${userId}`;
    const existing = this.receipts.get(key);
    if (existing) return { ...existing };

    const receipt: ReadReceipt = { status: 'READ', readAt: this.tick() };
    this.receipts.set(key, receipt);
    return { ...receipt };
  }

  getReceipt(chatId: string, messageId: string, userId: string): ReadReceipt | null {
    const receipt = this.receipts.get(`${chatId}:${messageId}:${userId}`);
    return receipt ? { ...receipt } : null;
  }

  async setLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeenPosition> {
    const message = this.chatMessages(chatId).get(messageId);
    if (!message) throw notFound('Message not found');

    const key = `${chatId}:${userId}`;
    const existing = this.lastSeen.get(key);

    if (existing) {
      const comparison = comparePositions(
        message.createdAt,
        message.id,
        existing.messageCreatedAt,
        existing.messageId,
      );
      // Monotonic: an older position (or the same one) never overwrites newer state.
      if (comparison <= 0) {
        return { lastSeenMessageId: existing.messageId, lastSeenAt: existing.lastSeenAt };
      }
    }

    const state: LastSeenState = {
      messageId,
      messageCreatedAt: message.createdAt,
      lastSeenAt: this.tick(),
    };
    this.lastSeen.set(key, state);

    return { lastSeenMessageId: messageId, lastSeenAt: state.lastSeenAt };
  }

  getLastSeen(chatId: string, userId: string): LastSeenState | null {
    const state = this.lastSeen.get(`${chatId}:${userId}`);
    return state ? { ...state } : null;
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<MessageRecord> {
    const message = this.chatMessages(chatId).get(messageId);
    if (!message) throw notFound('Message not found');
    if (message.isDeleted) throw conflict('Deleted messages cannot be edited');

    message.text = text;
    message.editedAt = this.tick();
    return { ...message };
  }

  async deleteMessage(chatId: string, messageId: string): Promise<MessageRecord> {
    const message = this.chatMessages(chatId).get(messageId);
    if (!message) throw notFound('Message not found');
    if (message.isDeleted) return { ...message };

    message.text = null;
    message.isDeleted = true;
    message.deletedAt = this.tick();
    return { ...message };
  }

  private insert(
    chatId: string,
    id: string,
    senderId: string,
    text: string,
    createdAt: Date,
  ): MessageRecord {
    const record: MessageRecord = {
      id,
      chatId,
      senderId,
      text,
      isDeleted: false,
      createdAt,
      editedAt: null,
      deletedAt: null,
    };
    this.chatMessages(chatId).set(id, record);
    return record;
  }
}

function compareRecords(a: MessageRecord, b: MessageRecord): number {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

function comparePositions(
  aDate: Date,
  aId: string,
  bDate: Date,
  bId: string,
): number {
  const diff = aDate.getTime() - bDate.getTime();
  return diff !== 0 ? diff : aId.localeCompare(bId);
}
