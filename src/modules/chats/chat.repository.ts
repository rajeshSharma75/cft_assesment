import { PoolClient } from 'pg';
import { query, withTransaction } from '../../config/database';
import {
  Chat,
  ChatMemberSummary,
  ChatRow,
  ChatSummary,
  ChatType,
} from '../../types';

const CHAT_COLUMNS =
  'id, name, type, direct_chat_key, created_by, last_activity_at, created_at, updated_at';

interface ChatSummaryRow {
  id: string;
  type: ChatType;
  name: string | null;
  created_at: Date;
  last_activity_at: Date;
  member_ids: string[];
}

interface MemberSummaryRow {
  id: string;
  name: string;
  email: string;
  joined_at: Date;
}

export interface CreateDirectChatParams {
  directChatKey: string;
  userAId: string;
  userBId: string;
  createdBy: string;
}

export interface CreateGroupChatParams {
  name: string;
  createdBy: string;
  memberIds: string[];
}

export interface ChatRepository {
  findById(chatId: string): Promise<Chat | null>;
  createDirectChat(params: CreateDirectChatParams): Promise<{ chat: Chat; isExisting: boolean }>;
  createGroupChat(params: CreateGroupChatParams): Promise<Chat>;
  isMember(chatId: string, userId: string): Promise<boolean>;
  countMembers(chatId: string): Promise<number>;
  listMemberIds(chatId: string): Promise<string[]>;
  listMembers(chatId: string): Promise<ChatMemberSummary[]>;
  listChatsForUser(userId: string): Promise<ChatSummary[]>;
  addMembers(chatId: string, userIds: string[]): Promise<string[]>;
  removeMember(chatId: string, userId: string): Promise<boolean>;
  touchActivity(chatId: string): Promise<void>;
}

export function mapChat(row: ChatRow): Chat {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    directChatKey: row.direct_chat_key,
    createdBy: row.created_by,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertMembers(
  client: PoolClient,
  chatId: string,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await client.query(
    `INSERT INTO chat_members (chat_id, user_id)
     SELECT $1::uuid, member_id
     FROM unnest($2::uuid[]) AS member_id
     ON CONFLICT (chat_id, user_id) DO NOTHING`,
    [chatId, [...new Set(userIds)]],
  );
}

export const chatRepository: ChatRepository = {
  async findById(chatId) {
    const result = await query<ChatRow>(`SELECT ${CHAT_COLUMNS} FROM chats WHERE id = $1`, [chatId]);
    const row = result.rows[0];
    return row ? mapChat(row) : null;
  },

  /**
   * Resolves or creates a direct chat. The unique `direct_chat_key` index is the
   * source of truth: two concurrent requests for the same pair cannot both
   * insert, and the loser reads the winner's row after the conflicting
   * transaction commits.
   */
  async createDirectChat({ directChatKey, userAId, userBId, createdBy }) {
    return withTransaction(async (client) => {
      const existing = await client.query<ChatRow>(
        `SELECT ${CHAT_COLUMNS} FROM chats WHERE direct_chat_key = $1`,
        [directChatKey],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        return { chat: mapChat(existingRow), isExisting: true };
      }

      const inserted = await client.query<ChatRow>(
        `INSERT INTO chats (type, direct_chat_key, created_by, last_activity_at)
         VALUES ('DIRECT', $1, $2, now())
         ON CONFLICT (direct_chat_key) DO NOTHING
         RETURNING ${CHAT_COLUMNS}`,
        [directChatKey, createdBy],
      );

      const insertedRow = inserted.rows[0];
      if (insertedRow) {
        await insertMembers(client, insertedRow.id, [userAId, userBId]);
        return { chat: mapChat(insertedRow), isExisting: false };
      }

      const raced = await client.query<ChatRow>(
        `SELECT ${CHAT_COLUMNS} FROM chats WHERE direct_chat_key = $1`,
        [directChatKey],
      );
      const racedRow = raced.rows[0];
      if (!racedRow) {
        throw new Error('Direct chat resolution failed after a uniqueness conflict');
      }
      return { chat: mapChat(racedRow), isExisting: true };
    });
  },

  async createGroupChat({ name, createdBy, memberIds }) {
    return withTransaction(async (client) => {
      const inserted = await client.query<ChatRow>(
        `INSERT INTO chats (name, type, created_by, last_activity_at)
         VALUES ($1, 'GROUP', $2, now())
         RETURNING ${CHAT_COLUMNS}`,
        [name, createdBy],
      );
      const chatRow = inserted.rows[0];
      if (!chatRow) throw new Error('Failed to create group chat');

      await insertMembers(client, chatRow.id, memberIds);

      return mapChat(chatRow);
    });
  },

  async isMember(chatId, userId) {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2
       ) AS exists`,
      [chatId, userId],
    );
    return result.rows[0]?.exists === true;
  },

  async countMembers(chatId) {
    const result = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM chat_members WHERE chat_id = $1`,
      [chatId],
    );
    return result.rows[0]?.count ?? 0;
  },

  async listMemberIds(chatId) {
    const result = await query<{ user_id: string }>(
      `SELECT user_id FROM chat_members WHERE chat_id = $1 ORDER BY joined_at ASC, user_id ASC`,
      [chatId],
    );
    return result.rows.map((row) => row.user_id);
  },

  async listMembers(chatId) {
    const result = await query<MemberSummaryRow>(
      `SELECT u.id, u.name, u.email, cm.joined_at
       FROM chat_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.chat_id = $1
       ORDER BY cm.joined_at ASC, u.id ASC`,
      [chatId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      joinedAt: row.joined_at,
    }));
  },

  async listChatsForUser(userId) {
    const result = await query<ChatSummaryRow>(
      `SELECT c.id, c.type, c.name, c.created_at, c.last_activity_at,
              array_agg(DISTINCT member.user_id) AS member_ids
       FROM chats c
       JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
       JOIN chat_members member ON member.chat_id = c.id
       GROUP BY c.id, c.type, c.name, c.created_at, c.last_activity_at
       ORDER BY c.last_activity_at DESC, c.created_at DESC`,
      [userId],
    );

    return result.rows.map((row) => ({
      chatId: row.id,
      type: row.type,
      name: row.name,
      memberIds: [...row.member_ids].sort(),
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
    }));
  },

  async addMembers(chatId, userIds) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];

    const result = await query<{ user_id: string }>(
      `INSERT INTO chat_members (chat_id, user_id)
       SELECT $1::uuid, member_id
       FROM unnest($2::uuid[]) AS member_id
       ON CONFLICT (chat_id, user_id) DO NOTHING
       RETURNING user_id`,
      [chatId, unique],
    );
    return result.rows.map((row) => row.user_id);
  },

  async removeMember(chatId, userId) {
    const result = await query<{ id: string }>(
      `DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2 RETURNING id`,
      [chatId, userId],
    );
    return result.rowCount === 1;
  },

  async touchActivity(chatId) {
    await query(
      `UPDATE chats SET last_activity_at = now(), updated_at = now() WHERE id = $1`,
      [chatId],
    );
  },
};
