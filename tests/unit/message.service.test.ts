import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatRepository } from '../../src/modules/chats/chat.repository';
import { MessageService } from '../../src/modules/chats/message.service';
import { AppError } from '../../src/utils/app-error';
import { encodeCursor } from '../../src/utils/cursor';
import { InMemoryMessageStore } from '../helpers/in-memory-message-store';
import { USER_1, USER_2, USER_3 } from '../helpers/database';

const CHAT_ID = '99999999-9999-4999-8999-999999999999';
const NOW = new Date('2026-01-01T10:00:00.000Z');

function mockChats(overrides: Partial<ChatRepository> = {}): ChatRepository {
  const base: ChatRepository = {
    findById: vi.fn(async () => ({
      id: CHAT_ID,
      name: null,
      type: 'DIRECT' as const,
      directChatKey: `${USER_1}_${USER_2}`,
      createdBy: USER_1,
      lastActivityAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    createDirectChat: vi.fn(),
    createGroupChat: vi.fn(),
    isMember: vi.fn(async (_chatId: string, userId: string) =>
      ([USER_1, USER_2] as string[]).includes(userId),
    ),
    countMembers: vi.fn(async () => 2),
    listMemberIds: vi.fn(async () => [USER_1, USER_2]),
    listMembers: vi.fn(async () => []),
    listChatsForUser: vi.fn(async () => []),
    addMembers: vi.fn(async () => []),
    removeMember: vi.fn(async () => true),
    touchActivity: vi.fn(async () => undefined),
  };
  return { ...base, ...overrides } as ChatRepository;
}

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).statusCode).toBe(status);
  expect((error as AppError).code).toBe(code);
}

describe('MessageService.sendMessage', () => {
  let store: InMemoryMessageStore;
  let chats: ChatRepository;
  let service: MessageService;

  beforeEach(() => {
    store = new InMemoryMessageStore();
    chats = mockChats();
    service = new MessageService(store, chats);
  });

  it('rejects a senderId that does not match the authenticated user', async () => {
    await expect(
      service.sendMessage(CHAT_ID, { senderId: USER_2, text: 'hi' }, USER_1),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, 'FORBIDDEN');
      return true;
    });
  });

  it('rejects non-members', async () => {
    await expect(
      service.sendMessage(CHAT_ID, { senderId: USER_3, text: 'hi' }, USER_3),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, 'FORBIDDEN');
      return true;
    });
  });

  it('stores the message and touches chat activity', async () => {
    const message = await service.sendMessage(CHAT_ID, { senderId: USER_1, text: 'Hello' }, USER_1);

    expect(message.chatId).toBe(CHAT_ID);
    expect(message.senderId).toBe(USER_1);
    expect(message.text).toBe('Hello');
    expect(message.isDeleted).toBe(false);
    expect(message.createdAt).toEqual(expect.any(String));
    expect(chats.touchActivity).toHaveBeenCalledWith(CHAT_ID);
    expect(await store.getMessage(CHAT_ID, message.messageId)).not.toBeNull();
  });

  it('returns the stored message even if updating PostgreSQL activity fails', async () => {
    chats = mockChats({
      touchActivity: vi.fn(async () => {
        throw new Error('database down');
      }),
    });
    service = new MessageService(store, chats);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const message = await service.sendMessage(CHAT_ID, { senderId: USER_1, text: 'Hello' }, USER_1);

    expect(message.messageId).toEqual(expect.any(String));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('deduplicates retries that reuse an idempotency key', async () => {
    const first = await service.sendMessage(
      CHAT_ID,
      { senderId: USER_1, text: 'Hello', idempotencyKey: 'key-1' },
      USER_1,
    );
    const second = await service.sendMessage(
      CHAT_ID,
      { senderId: USER_1, text: 'Hello', idempotencyKey: 'key-1' },
      USER_1,
    );

    expect(second.messageId).toBe(first.messageId);
    expect(second.createdAt).toBe(first.createdAt);
  });
});

describe('MessageService.listMessages', () => {
  it('returns chronological messages with a stable cursor for identical timestamps', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const timestamp = new Date('2026-01-01T09:00:00.000Z');

    store.seedMessage(CHAT_ID, { id: 'msg_c', senderId: USER_1, createdAt: timestamp });
    store.seedMessage(CHAT_ID, { id: 'msg_a', senderId: USER_1, createdAt: timestamp });
    store.seedMessage(CHAT_ID, { id: 'msg_b', senderId: USER_2, createdAt: timestamp });

    const firstPage = await service.listMessages(CHAT_ID, USER_1, { limit: 2 });

    expect(firstPage.messages.map((message) => message.messageId)).toEqual(['msg_a', 'msg_b']);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await service.listMessages(CHAT_ID, USER_1, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage.messages.map((message) => message.messageId)).toEqual(['msg_c']);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor', async () => {
    const service = new MessageService(new InMemoryMessageStore(), mockChats());

    await expect(
      service.listMessages(CHAT_ID, USER_1, { limit: 10, cursor: 'not-a-cursor' }),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 400, 'BAD_REQUEST');
      return true;
    });
  });

  it('returns deleted messages as placeholders without text', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());

    store.seedMessage(CHAT_ID, {
      id: 'msg_deleted',
      senderId: USER_1,
      text: 'gone',
      createdAt: new Date(),
      isDeleted: true,
    });

    const page = await service.listMessages(CHAT_ID, USER_1, { limit: 10 });
    expect(page.messages[0]).toMatchObject({
      messageId: 'msg_deleted',
      text: null,
      isDeleted: true,
    });
  });

  it('round-trips cursors through the shared encoding', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const timestamp = new Date('2026-02-02T02:02:02.000Z');

    store.seedMessage(CHAT_ID, { id: 'msg_1', senderId: USER_1, createdAt: timestamp });
    store.seedMessage(CHAT_ID, {
      id: 'msg_2',
      senderId: USER_1,
      createdAt: new Date(timestamp.getTime() + 1000),
    });

    const cursor = encodeCursor({
      seconds: Math.floor(timestamp.getTime() / 1000),
      nanoseconds: 0,
      messageId: 'msg_1',
    });

    const page = await service.listMessages(CHAT_ID, USER_1, { limit: 10, cursor });
    expect(page.messages.map((message) => message.messageId)).toEqual(['msg_2']);
  });
});

describe('MessageService read receipts', () => {
  it('rejects marking your own message as read', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const message = await service.sendMessage(CHAT_ID, { senderId: USER_1, text: 'hi' }, USER_1);

    await expect(
      service.markMessageRead(CHAT_ID, message.messageId, USER_1, USER_1),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, 'FORBIDDEN');
      return true;
    });
  });

  it('is idempotent and preserves the original read timestamp', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const message = await service.sendMessage(CHAT_ID, { senderId: USER_1, text: 'hi' }, USER_1);

    const first = await service.markMessageRead(CHAT_ID, message.messageId, USER_2, USER_2);
    const second = await service.markMessageRead(CHAT_ID, message.messageId, USER_2, USER_2);

    expect(second.readAt).toBe(first.readAt);
    expect(store.getReceipt(CHAT_ID, message.messageId, USER_2)?.readAt.toISOString()).toBe(
      first.readAt,
    );
  });

  it('rejects marking a message that does not exist', async () => {
    const service = new MessageService(new InMemoryMessageStore(), mockChats());

    await expect(service.markMessageRead(CHAT_ID, 'missing', USER_2, USER_2)).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 404, 'NOT_FOUND');
        return true;
      },
    );
  });
});

describe('MessageService last seen', () => {
  it('never moves the last-seen position backwards', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const base = new Date('2026-03-01T10:00:00.000Z');

    store.seedMessage(CHAT_ID, { id: 'msg_old', senderId: USER_1, createdAt: base });
    store.seedMessage(CHAT_ID, {
      id: 'msg_new',
      senderId: USER_1,
      createdAt: new Date(base.getTime() + 60_000),
    });

    await service.updateLastSeen(CHAT_ID, USER_2, 'msg_new', USER_2);
    const result = await service.updateLastSeen(CHAT_ID, USER_2, 'msg_old', USER_2);

    expect(result.lastSeenMessageId).toBe('msg_new');
  });

  it('rejects last seen for a message outside the chat', async () => {
    const service = new MessageService(new InMemoryMessageStore(), mockChats());

    await expect(
      service.updateLastSeen(CHAT_ID, USER_2, 'missing', USER_2),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 404, 'NOT_FOUND');
      return true;
    });
  });

  it('rejects another user impersonating the actor', async () => {
    const service = new MessageService(new InMemoryMessageStore(), mockChats());

    await expect(
      service.updateLastSeen(CHAT_ID, USER_2, 'msg', USER_1),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, 'FORBIDDEN');
      return true;
    });
  });
});

describe('MessageService edit and delete permissions', () => {
  it('only allows the original sender to edit', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const message = await service.sendMessage(CHAT_ID, { senderId: USER_1, text: 'v1' }, USER_1);

    await expect(
      service.editMessage(CHAT_ID, message.messageId, 'hacked', USER_2),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, 'FORBIDDEN');
      return true;
    });
  });

  it('edits the text, sets editedAt and preserves createdAt', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const message = await service.sendMessage(CHAT_ID, { senderId: USER_1, text: 'v1' }, USER_1);

    const edited = await service.editMessage(CHAT_ID, message.messageId, 'v2', USER_1);

    expect(edited.text).toBe('v2');
    expect(edited.createdAt).toBe(message.createdAt);
    expect(edited.editedAt).toEqual(expect.any(String));
  });

  it('only allows the original sender to delete', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const message = await service.sendMessage(CHAT_ID, { senderId: USER_1, text: 'v1' }, USER_1);

    await expect(
      service.deleteMessage(CHAT_ID, message.messageId, USER_2),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, 'FORBIDDEN');
      return true;
    });
  });

  it('soft deletes, clears text and blocks further edits', async () => {
    const store = new InMemoryMessageStore();
    const service = new MessageService(store, mockChats());
    const message = await service.sendMessage(CHAT_ID, { senderId: USER_1, text: 'v1' }, USER_1);

    const deleted = await service.deleteMessage(CHAT_ID, message.messageId, USER_1);
    expect(deleted.text).toBeNull();
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.deletedAt).toEqual(expect.any(String));

    await expect(
      service.editMessage(CHAT_ID, message.messageId, 'again', USER_1),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 409, 'CONFLICT');
      return true;
    });
  });
});
