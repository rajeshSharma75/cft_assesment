import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query, withTransaction } from '../../src/config/database';
import { ChatService } from '../../src/modules/chats/chat.service';
import { chatRepository } from '../../src/modules/chats/chat.repository';
import { resetAndSeed, USER_1, USER_2, USER_3, USER_5 } from '../helpers/database';

beforeEach(async () => {
  await resetAndSeed();
});

afterAll(async () => {
  await closePool();
});

interface PgError extends Error {
  code?: string;
}

async function expectPostgresError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect((caught as PgError).code).toBe(code);
}

describe('PostgreSQL schema constraints', () => {
  it('rejects memberships for unknown chats (foreign key)', async () => {
    await expectPostgresError(
      query(
        `INSERT INTO chat_members (chat_id, user_id)
         VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1)`,
        [USER_1],
      ),
      '23503',
    );
  });

  it('rejects duplicate memberships (unique constraint)', async () => {
    const chat = await query<{ id: string }>(
      `INSERT INTO chats (type, direct_chat_key, created_by)
       VALUES ('DIRECT', $1, $2) RETURNING id`,
      [`${USER_1}_${USER_2}`, USER_1],
    );
    const chatId = chat.rows[0]?.id as string;

    await query(`INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)`, [chatId, USER_1]);

    await expectPostgresError(
      query(`INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)`, [chatId, USER_1]),
      '23505',
    );
  });

  it('rejects duplicate direct chat keys', async () => {
    const key = `${USER_1}_${USER_2}`;
    await query(
      `INSERT INTO chats (type, direct_chat_key, created_by) VALUES ('DIRECT', $1, $2)`,
      [key, USER_1],
    );

    await expectPostgresError(
      query(
        `INSERT INTO chats (type, direct_chat_key, created_by) VALUES ('DIRECT', $1, $2)`,
        [key, USER_1],
      ),
      '23505',
    );
  });

  it('rejects duplicate emails', async () => {
    await expectPostgresError(
      query(`INSERT INTO users (name, email) VALUES ('Duplicate', 'aarav.sharma@example.com')`),
      '23505',
    );
  });

  it('enforces the direct/group shape checks', async () => {
    await expectPostgresError(
      query(`INSERT INTO chats (type, created_by) VALUES ('DIRECT', $1)`, [USER_1]),
      '23514',
    );

    await expectPostgresError(
      query(`INSERT INTO chats (type, direct_chat_key, created_by) VALUES ('GROUP', 'a_b', $1)`, [
        USER_1,
      ]),
      '23514',
    );

    await expectPostgresError(
      query(`INSERT INTO chats (type, created_by) VALUES ('GROUP', $1)`, [USER_1]),
      '23514',
    );
  });

  it('cascades chat member deletion when a chat is deleted', async () => {
    const chat = await chatRepository.createDirectChat({
      directChatKey: `${USER_1}_${USER_2}`,
      userAId: USER_1,
      userBId: USER_2,
      createdBy: USER_1,
    });

    await query('DELETE FROM chats WHERE id = $1', [chat.chat.id]);

    const members = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM chat_members WHERE chat_id = $1',
      [chat.chat.id],
    );
    expect(members.rows[0]?.count).toBe(0);
  });
});

describe('transactions', () => {
  it('rolls back every statement when the callback throws', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query(
          `INSERT INTO chats (type, direct_chat_key, created_by) VALUES ('DIRECT', 'rollback_key', $1)`,
          [USER_1],
        );
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    const result = await query(`SELECT 1 FROM chats WHERE direct_chat_key = 'rollback_key'`);
    expect(result.rowCount).toBe(0);
  });
});

describe('concurrent direct chat creation', () => {
  it('creates exactly one conversation for parallel requests', async () => {
    const service = new ChatService();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        service.createOrGetDirectChat(
          { userAId: index % 2 === 0 ? USER_1 : USER_2, userBId: index % 2 === 0 ? USER_2 : USER_1 },
          USER_1,
        ),
      ),
    );

    const chatIds = new Set(results.map((result) => result.chatId));
    expect(chatIds.size).toBe(1);
    expect(results.filter((result) => result.isExisting === false)).toHaveLength(1);

    const chats = await query<{ count: number }>('SELECT count(*)::int AS count FROM chats');
    const members = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM chat_members',
    );

    expect(chats.rows[0]?.count).toBe(1);
    expect(members.rows[0]?.count).toBe(2);
  });
});

describe('repository operations', () => {
  it('adds and removes group members safely', async () => {
    const chat = await chatRepository.createGroupChat({
      name: 'Repo Group',
      createdBy: USER_1,
      memberIds: [USER_1, USER_2, USER_3],
    });

    expect(await chatRepository.countMembers(chat.id)).toBe(3);

    const added = await chatRepository.addMembers(chat.id, [USER_3, USER_5]);
    expect(added).toEqual([USER_5]);
    expect(await chatRepository.countMembers(chat.id)).toBe(4);

    expect(await chatRepository.removeMember(chat.id, USER_5)).toBe(true);
    expect(await chatRepository.isMember(chat.id, USER_5)).toBe(false);
    expect(await chatRepository.removeMember(chat.id, USER_5)).toBe(false);
  });

  it('lists chats for a user ordered by latest activity', async () => {
    const direct = await chatRepository.createDirectChat({
      directChatKey: `${USER_1}_${USER_2}`,
      userAId: USER_1,
      userBId: USER_2,
      createdBy: USER_1,
    });
    const group = await chatRepository.createGroupChat({
      name: 'Group',
      createdBy: USER_1,
      memberIds: [USER_1, USER_2, USER_3],
    });

    await chatRepository.touchActivity(direct.chat.id);

    const chats = await chatRepository.listChatsForUser(USER_1);

    expect(chats).toHaveLength(2);
    expect(chats[0]?.chatId).toBe(direct.chat.id);
    expect(chats[1]?.chatId).toBe(group.id);
    expect(chats[0]?.memberIds).toEqual([USER_1, USER_2].sort());
    expect(chats[1]?.memberIds).toEqual([USER_1, USER_2, USER_3].sort());
  });

  it('returns member details with user information', async () => {
    const chat = await chatRepository.createGroupChat({
      name: 'Group',
      createdBy: USER_1,
      memberIds: [USER_1, USER_2],
    });

    const members = await chatRepository.listMembers(chat.id);

    expect(members).toHaveLength(2);
    expect(members.map((member) => member.id).sort()).toEqual([USER_1, USER_2].sort());
    expect(members[0]?.email).toEqual(expect.stringContaining('@example.com'));
  });
});
