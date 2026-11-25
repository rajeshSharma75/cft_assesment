import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '../../src/modules/chats/chat.service';
import { ChatRepository } from '../../src/modules/chats/chat.repository';
import { UserRepository } from '../../src/modules/users/user.repository';
import { Chat, ChatMemberSummary, User } from '../../src/types';
import { AppError } from '../../src/utils/app-error';
import { USER_1, USER_2, USER_3, USER_4 } from '../helpers/database';

const NOW = new Date('2026-01-01T10:00:00.000Z');

function makeUser(id: string, name = `User ${id.slice(0, 4)}`): User {
  return {
    id,
    name,
    email: `${id.slice(0, 4)}@example.com`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    name: null,
    type: 'DIRECT',
    directChatKey: `${USER_1}_${USER_2}`,
    createdBy: USER_1,
    lastActivityAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function mockUsers(users: User[] = [makeUser(USER_1), makeUser(USER_2), makeUser(USER_3), makeUser(USER_4)]) {
  const repository: UserRepository = {
    findById: vi.fn(async (id: string) => users.find((user) => user.id === id) ?? null),
    findByIds: vi.fn(async (ids: string[]) => users.filter((user) => ids.includes(user.id))),
    findByEmail: vi.fn(async () => null),
    list: vi.fn(async () => users),
  };
  return repository;
}

function mockChats(overrides: Partial<ChatRepository> = {}) {
  const base: ChatRepository = {
    findById: vi.fn(async () => null),
    createDirectChat: vi.fn(async () => ({ chat: makeChat(), isExisting: false })),
    createGroupChat: vi.fn(async ({ name }: { name: string }) =>
      makeChat({ type: 'GROUP', name, directChatKey: null }),
    ),
    isMember: vi.fn(async () => true),
    countMembers: vi.fn(async () => 2),
    listMemberIds: vi.fn(async () => [USER_1, USER_2]),
    listMembers: vi.fn(async (): Promise<ChatMemberSummary[]> => []),
    listChatsForUser: vi.fn(async () => []),
    addMembers: vi.fn(async (_chatId: string, ids: string[]) => ids),
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

describe('ChatService.createOrGetDirectChat', () => {
  it('rejects creating a chat with the same user twice', async () => {
    const service = new ChatService(mockChats(), mockUsers());

    await expect(
      service.createOrGetDirectChat({ userAId: USER_1, userBId: USER_1 }, USER_1),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 400, 'BAD_REQUEST');
      return true;
    });
  });

  it('rejects an authenticated user who is not a participant', async () => {
    const service = new ChatService(mockChats(), mockUsers());

    await expect(
      service.createOrGetDirectChat({ userAId: USER_1, userBId: USER_2 }, USER_3),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, 'FORBIDDEN');
      return true;
    });
  });

  it('returns 404 when a participant does not exist', async () => {
    const chats = mockChats();
    const service = new ChatService(chats, mockUsers());

    await expect(
      service.createOrGetDirectChat({ userAId: USER_1, userBId: USER_5Missing }, USER_1),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 404, 'NOT_FOUND');
      return true;
    });
    expect(chats.createDirectChat).not.toHaveBeenCalled();
  });

  it('passes a deterministic key and reports an existing chat', async () => {
    const chats = mockChats({
      createDirectChat: vi.fn(async () => ({ chat: makeChat(), isExisting: true })),
    });
    const service = new ChatService(chats, mockUsers());

    const result = await service.createOrGetDirectChat(
      { userAId: USER_2, userBId: USER_1 },
      USER_2,
    );

    expect(result).toEqual({ chatId: makeChat().id, isExisting: true });
    expect(chats.createDirectChat).toHaveBeenCalledWith(
      expect.objectContaining({
        directChatKey: [USER_1, USER_2].sort().join('_'),
        createdBy: USER_2,
      }),
    );
  });
});

const USER_5Missing = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('ChatService.createGroupChat', () => {
  it('requires at least two other participants', async () => {
    const service = new ChatService(mockChats(), mockUsers());

    await expect(
      service.createGroupChat({ name: 'Team', participantIds: [USER_1, USER_2] }, USER_1),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 400, 'BAD_REQUEST');
      return true;
    });
  });

  it('deduplicates participants, includes the creator and trims the name', async () => {
    const chats = mockChats();
    const service = new ChatService(chats, mockUsers());

    const result = await service.createGroupChat(
      { name: '  Dev Team  ', participantIds: [USER_2, USER_2, USER_3] },
      USER_1,
    );

    expect(result.type).toBe('GROUP');
    expect(result.name).toBe('Dev Team');
    expect(result.memberIds).toEqual([USER_1, USER_2, USER_3]);
    expect(chats.createGroupChat).toHaveBeenCalledWith({
      name: 'Dev Team',
      createdBy: USER_1,
      memberIds: [USER_1, USER_2, USER_3],
    });
  });

  it('rejects unknown participants', async () => {
    const service = new ChatService(mockChats(), mockUsers());

    await expect(
      service.createGroupChat(
        { name: 'Team', participantIds: [USER_2, USER_5Missing] },
        USER_1,
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 404, 'NOT_FOUND');
      return true;
    });
  });
});

describe('ChatService membership management', () => {
  it('rejects membership changes in direct chats', async () => {
    const chats = mockChats({ findById: vi.fn(async () => makeChat()) });
    const service = new ChatService(chats, mockUsers());

    await expect(service.addMembers(makeChat().id, USER_1, [USER_3])).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 400, 'BAD_REQUEST');
        return true;
      },
    );
  });

  it('rejects adding members when the actor is not a member', async () => {
    const chats = mockChats({
      findById: vi.fn(async () => makeChat({ type: 'GROUP', name: 'Team' })),
      isMember: vi.fn(async () => false),
    });
    const service = new ChatService(chats, mockUsers());

    await expect(service.addMembers(makeChat().id, USER_1, [USER_3])).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 403, 'FORBIDDEN');
        return true;
      },
    );
  });

  it('lets a member leave the group', async () => {
    const chats = mockChats({
      findById: vi.fn(async () => makeChat({ type: 'GROUP', name: 'Team', createdBy: USER_1 })),
      listMemberIds: vi
        .fn()
        .mockResolvedValueOnce([USER_1, USER_2, USER_3])
        .mockResolvedValueOnce([USER_1, USER_3]),
    });
    const service = new ChatService(chats, mockUsers());

    const result = await service.removeMember(makeChat().id, USER_2, USER_2);

    expect(result.removedUserId).toBe(USER_2);
    expect(result.memberIds).toEqual([USER_1, USER_3]);
    expect(chats.removeMember).toHaveBeenCalledWith(makeChat().id, USER_2);
  });

  it('forbids a non-creator member from removing someone else', async () => {
    const chats = mockChats({
      findById: vi.fn(async () => makeChat({ type: 'GROUP', name: 'Team', createdBy: USER_1 })),
    });
    const service = new ChatService(chats, mockUsers());

    await expect(service.removeMember(makeChat().id, USER_2, USER_3)).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 403, 'FORBIDDEN');
        return true;
      },
    );
  });

  it('forbids removing the creator', async () => {
    const chats = mockChats({
      findById: vi.fn(async () => makeChat({ type: 'GROUP', name: 'Team', createdBy: USER_1 })),
    });
    const service = new ChatService(chats, mockUsers());

    await expect(service.removeMember(makeChat().id, USER_2, USER_1)).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 403, 'FORBIDDEN');
        return true;
      },
    );
  });

  it('lets the creator remove another member', async () => {
    const chats = mockChats({
      findById: vi.fn(async () => makeChat({ type: 'GROUP', name: 'Team', createdBy: USER_1 })),
      listMemberIds: vi
        .fn()
        .mockResolvedValueOnce([USER_1, USER_2, USER_3])
        .mockResolvedValueOnce([USER_1, USER_2]),
    });
    const service = new ChatService(chats, mockUsers());

    const result = await service.removeMember(makeChat().id, USER_1, USER_3);
    expect(result.memberIds).toEqual([USER_1, USER_2]);
  });

  it('rejects removing a non-member', async () => {
    const chats = mockChats({
      findById: vi.fn(async () => makeChat({ type: 'GROUP', name: 'Team', createdBy: USER_1 })),
      listMemberIds: vi.fn(async () => [USER_1, USER_2]),
    });
    const service = new ChatService(chats, mockUsers());

    await expect(service.removeMember(makeChat().id, USER_1, USER_3)).rejects.toSatisfy(
      (error: unknown) => {
        expectAppError(error, 404, 'NOT_FOUND');
        return true;
      },
    );
  });
});

describe('ChatService.listUserChats', () => {
  it('forbids listing another user\u2019s chats', async () => {
    const service = new ChatService(mockChats(), mockUsers());

    await expect(service.listUserChats(USER_1, USER_2)).rejects.toSatisfy((error: unknown) => {
      expectAppError(error, 403, 'FORBIDDEN');
      return true;
    });
  });

  it('maps repository summaries to DTOs', async () => {
    const chats = mockChats({
      listChatsForUser: vi.fn(async () => [
        {
          chatId: 'chat-1',
          type: 'DIRECT' as const,
          name: null,
          memberIds: [USER_2, USER_1],
          createdAt: NOW,
          lastActivityAt: NOW,
        },
      ]),
    });
    const service = new ChatService(chats, mockUsers());

    const result = await service.listUserChats(USER_1, USER_1);

    expect(result).toEqual([
      {
        chatId: 'chat-1',
        type: 'DIRECT',
        name: null,
        members: [USER_2, USER_1],
        createdAt: NOW.toISOString(),
        lastActivityAt: NOW.toISOString(),
      },
    ]);
  });
});
