import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../src/config/database';
import { authHeader, createDirectChat, createTestContext, TestContext } from '../helpers/test-app';
import { resetAndSeed, USER_1, USER_2, USER_3, USER_4, USER_5 } from '../helpers/database';

let ctx: TestContext;

beforeEach(async () => {
  await resetAndSeed();
  ctx = createTestContext();
});

afterAll(async () => {
  await closePool();
});

async function createGroup(
  api: ReturnType<typeof request>,
  members: string[] = [USER_2, USER_3],
) {
  const response = await api
    .post('/chat/group/create')
    .set(authHeader(USER_1))
    .send({ name: 'Development Team', participantIds: members });

  return response;
}

describe('Bonus: create group chat', () => {
  it('creates a group with the creator as a member', async () => {
    const response = await createGroup(request(ctx.app));

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      type: 'GROUP',
      name: 'Development Team',
      memberIds: [USER_1, USER_2, USER_3],
    });

    const members = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM chat_members WHERE chat_id = $1',
      [response.body.data.chatId],
    );
    expect(members.rows[0]?.count).toBe(3);
  });

  it('deduplicates participants', async () => {
    const response = await createGroup(request(ctx.app), [USER_2, USER_2, USER_3]);
    expect(response.body.data.memberIds).toEqual([USER_1, USER_2, USER_3]);
  });

  it('requires at least two participants', async () => {
    const response = await createGroup(request(ctx.app), [USER_2]);
    expect(response.status).toBe(422);
  });

  it('rejects unknown participants', async () => {
    const unknownUser = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const response = await createGroup(request(ctx.app), [USER_2, unknownUser]);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('validates the group name', async () => {
    const response = await request(ctx.app)
      .post('/chat/group/create')
      .set(authHeader(USER_1))
      .send({ name: '   ', participantIds: [USER_2, USER_3] });

    expect(response.status).toBe(422);
  });
});

describe('Bonus: group membership management', () => {
  async function groupId(api: ReturnType<typeof request>): Promise<string> {
    const response = await createGroup(api);
    return response.body.data.chatId;
  }

  it('lists members with basic user info', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const response = await api.get(`/chat/${chatId}/members`).set(authHeader(USER_2));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data[0]).toMatchObject({
      userId: expect.any(String),
      name: expect.any(String),
      email: expect.any(String),
      joinedAt: expect.any(String),
    });
  });

  it('allows an existing member to add new members', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const response = await api
      .post(`/chat/${chatId}/members`)
      .set(authHeader(USER_2))
      .send({ participantIds: [USER_4] });

    expect(response.status).toBe(200);
    expect(response.body.data.addedMemberIds).toEqual([USER_4]);
    expect(response.body.data.memberIds).toEqual(
      expect.arrayContaining([USER_1, USER_2, USER_3, USER_4]),
    );
  });

  it('does not duplicate existing members', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const response = await api
      .post(`/chat/${chatId}/members`)
      .set(authHeader(USER_1))
      .send({ participantIds: [USER_2] });

    expect(response.body.data.addedMemberIds).toEqual([]);
  });

  it('rejects adding members to a direct chat', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const response = await api
      .post(`/chat/${chatId}/members`)
      .set(authHeader(USER_1))
      .send({ participantIds: [USER_4] });

    expect(response.status).toBe(400);
  });

  it('rejects membership changes from non-members', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const response = await api
      .post(`/chat/${chatId}/members`)
      .set(authHeader(USER_5))
      .send({ participantIds: [USER_4] });

    expect(response.status).toBe(403);
  });

  it('lets the creator remove another member and revokes access', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const removal = await api.delete(`/chat/${chatId}/members/${USER_2}`).set(authHeader(USER_1));
    expect(removal.status).toBe(200);
    expect(removal.body.data.memberIds).not.toContain(USER_2);

    const membersAfter = await api.get(`/chat/${chatId}/members`).set(authHeader(USER_2));
    expect(membersAfter.status).toBe(403);

    const sendAfter = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_2))
      .send({ senderId: USER_2, text: 'still here?' });
    expect(sendAfter.status).toBe(403);
  });

  it('forbids a non-creator member from removing someone else', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const response = await api.delete(`/chat/${chatId}/members/${USER_3}`).set(authHeader(USER_2));
    expect(response.status).toBe(403);
  });

  it('forbids removing the creator', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const response = await api.delete(`/chat/${chatId}/members/${USER_1}`).set(authHeader(USER_2));
    expect(response.status).toBe(403);
  });

  it('lets a member leave the group', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const response = await api.delete(`/chat/${chatId}/members/${USER_2}`).set(authHeader(USER_2));

    expect(response.status).toBe(200);
    expect(response.body.data.removedUserId).toBe(USER_2);
    expect(response.body.data.memberIds).not.toContain(USER_2);
  });

  it('rejects membership management on direct chats', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const response = await api.delete(`/chat/${chatId}/members/${USER_2}`).set(authHeader(USER_1));
    expect(response.status).toBe(400);
  });

  it('hides group members from non-members', async () => {
    const api = request(ctx.app);
    const chatId = await groupId(api);

    const response = await api.get(`/chat/${chatId}/members`).set(authHeader(USER_5));
    expect(response.status).toBe(403);
  });
});
