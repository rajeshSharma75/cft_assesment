import { query } from '../../config/database';
import { User, UserRow } from '../../types';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByIds(ids: string[]): Promise<User[]>;
  findByEmail(email: string): Promise<User | null>;
  list(limit?: number): Promise<User[]>;
}

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = 'id, name, email, created_at, updated_at';

export const userRepository: UserRepository = {
  async findById(id) {
    const result = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row ? mapUser(row) : null;
  },

  async findByIds(ids) {
    if (ids.length === 0) return [];
    const result = await query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return result.rows.map(mapUser);
  },

  async findByEmail(email) {
    const result = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE lower(email) = lower($1)`, [
      email,
    ]);
    const row = result.rows[0];
    return row ? mapUser(row) : null;
  },

  async list(limit = 100) {
    const result = await query<UserRow>(
      `SELECT ${COLUMNS} FROM users ORDER BY created_at ASC LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapUser);
  },
};
