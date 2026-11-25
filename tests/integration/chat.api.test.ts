import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, query } from '../../src/config/database';
import { authHeader, createDirectChat, createTestContext, TestContext } from '../helpers/test-app';
import { resetAndSeed, USER_1, USER_2, USER_3 } from '../helpers/database';

let ctx: TestContext;

beforeEach(async () => {
  await resetAndSeed();
  ctx = createTestContext();
});

afterAll(async () => {
  await closePool();
});

describe('API 1: POST /chat/create', () => {
  it('creates a direct chat and returns isExisting=false', async () => {
    const response = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_1))
      .send({ userAId: USER_1, userBId: USER_2 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.chatId).toEqual(expect.any(String));
    expect(response.body.data.isExisting).toBe(false);

    const chats = await query<{ count: number }>('SELECT count(*)::int AS count FROM chats');
    expect(chats.rows[0]?.count).toBe(1);
  });

  it('returns the same chat when called with reversed participant order', async () => {
    const first = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_1))
      .send({ userAId: USER_1, userBId: USER_2 });

    const second = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_2))
      .send({ userAId: USER_2, userBId: USER_1 });

    expect(second.status).toBe(200);
    expect(second.body.data.chatId).toBe(first.body.data.chatId);
    expect(second.body.data.isExisting).toBe(true);

    const members = await query<{ count: number }>('SELECT count(*)::int AS count FROM chat_members');
    expect(members.rows[0]?.count).toBe(2);
  });

  it('rejects a chat with oneself', async () => {
    const response = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_1))
      .send({ userAId: USER_1, userBId: USER_1 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: 'BAD_REQUEST' });
  });

  it('rejects an authenticated non-participant', async () => {
    const response = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_3))
      .send({ userAId: USER_1, userBId: USER_2 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('returns 404 for unknown users', async () => {
    const unknownUser = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const response = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_1))
      .send({ userAId: USER_1, userBId: unknownUser });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('validates UUID inputs', async () => {
    const response = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_1))
      .send({ userAId: 'not-a-uuid', userBId: USER_2 });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('API 2 + 3: send and fetch messages', () => {
  it('stores a message and returns it chronologically', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const first = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'First message' });
    const second = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_2))
      .send({ senderId: USER_2, text: 'Second message' });

    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      chatId,
      senderId: USER_1,
      text: 'First message',
      isDeleted: false,
    });
    expect(second.status).toBe(201);

    const list = await api.get(`/chat/${chatId}/messages`).set(authHeader(USER_1));

    expect(list.status).toBe(200);
    expect(list.body.data.messages.map((m: { text: string }) => m.text)).toEqual([
      'First message',
      'Second message',
    ]);
    expect(list.body.data.hasMore).toBe(false);
    expect(list.body.data.nextCursor).toBeNull();
  });

  it('supports cursor pagination with a stable ordering', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    for (let index = 0; index < 5; index += 1) {
      await api
        .post(`/chat/${chatId}/message/send`)
        .set(authHeader(USER_1))
        .send({ senderId: USER_1, text: `Message ${index}` });
    }

    const pageOne = await api
      .get(`/chat/${chatId}/messages?limit=2`)
      .set(authHeader(USER_1));
    expect(pageOne.status).toBe(200);
    expect(pageOne.body.data.messages).toHaveLength(2);
    expect(pageOne.body.data.hasMore).toBe(true);
    expect(pageOne.body.data.nextCursor).toEqual(expect.any(String));

    const pageTwo = await api
      .get(`/chat/${chatId}/messages?limit=2&cursor=${encodeURIComponent(pageOne.body.data.nextCursor)}`)
      .set(authHeader(USER_1));
    expect(pageTwo.body.data.messages).toHaveLength(2);

    const texts = [
      ...pageOne.body.data.messages.map((m: { text: string }) => m.text),
      ...pageTwo.body.data.messages.map((m: { text: string }) => m.text),
    ];
    expect(texts).toEqual(['Message 0', 'Message 1', 'Message 2', 'Message 3']);
  });

  it('rejects a malformed cursor and an out-of-range limit', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const badCursor = await api
      .get(`/chat/${chatId}/messages?cursor=broken`)
      .set(authHeader(USER_1));
    expect(badCursor.status).toBe(400);

    const badLimit = await api
      .get(`/chat/${chatId}/messages?limit=500`)
      .set(authHeader(USER_1));
    expect(badLimit.status).toBe(422);
  });

  it('is idempotent when the same idempotency key is retried', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const payload = { senderId: USER_1, text: 'Only once', idempotencyKey: 'retry-1' };
    const first = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send(payload);
    const second = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send(payload);

    expect(second.body.data.messageId).toBe(first.body.data.messageId);
    const list = await api.get(`/chat/${chatId}/messages`).set(authHeader(USER_1));
    expect(list.body.data.messages).toHaveLength(1);
  });

  it('returns 404 when the chat does not exist', async () => {
    const response = await request(ctx.app)
      .post('/chat/99999999-9999-4999-8999-999999999999/message/send')
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'hello' });

    expect(response.status).toBe(404);
  });

  it('returns 404 when another user fetches messages of an unknown chat', async () => {
    const response = await request(ctx.app)
      .get('/chat/99999999-9999-4999-8999-999999999999/messages')
      .set(authHeader(USER_3));

    expect(response.status).toBe(404);
  });
});

describe('API 4: mark message read', () => {
  async function sendMessage(api: ReturnType<typeof request>, chatId: string, text = 'hello') {
    const response = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text });
    return response.body.data.messageId as string;
  }

  it('creates a receipt and keeps the original read timestamp on retries', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);
    const messageId = await sendMessage(api, chatId);

    const first = await api
      .post(`/chat/${chatId}/message/${messageId}/read`)
      .set(authHeader(USER_2))
      .send({ userId: USER_2 });
    const second = await api
      .post(`/chat/${chatId}/message/${messageId}/read`)
      .set(authHeader(USER_2))
      .send({ userId: USER_2 });

    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ messageId, userId: USER_2, status: 'READ' });
    expect(second.body.data.readAt).toBe(first.body.data.readAt);
  });

  it('prevents a sender from marking their own message as read', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);
    const messageId = await sendMessage(api, chatId);

    const response = await api
      .post(`/chat/${chatId}/message/${messageId}/read`)
      .set(authHeader(USER_1))
      .send({ userId: USER_1 });

    expect(response.status).toBe(403);
  });

  it('returns 404 for an unknown message', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const response = await api
      .post(`/chat/${chatId}/message/missing-message/read`)
      .set(authHeader(USER_2))
      .send({ userId: USER_2 });

    expect(response.status).toBe(404);
  });
});

describe('API 5: update last seen', () => {
  it('does not move backwards', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const first = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'one' });
    const second = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'two' });

    await api
      .post(`/chat/${chatId}/lastseen`)
      .set(authHeader(USER_2))
      .send({ userId: USER_2, messageId: second.body.data.messageId });

    const backwards = await api
      .post(`/chat/${chatId}/lastseen`)
      .set(authHeader(USER_2))
      .send({ userId: USER_2, messageId: first.body.data.messageId });

    expect(backwards.status).toBe(200);
    expect(backwards.body.data.lastSeenMessageId).toBe(second.body.data.messageId);
  });

  it('rejects a message that does not exist', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const response = await api
      .post(`/chat/${chatId}/lastseen`)
      .set(authHeader(USER_2))
      .send({ userId: USER_2, messageId: 'nope' });

    expect(response.status).toBe(404);
  });
});

describe('API 6: GET /user/:userId/chats', () => {
  it('lists chats with members, newest activity first', async () => {
    const api = request(ctx.app);
    const chatWithTwo = await createDirectChat(api, USER_1, USER_2);
    const chatWithThree = await createDirectChat(api, USER_1, USER_3);

    // Activity on the older chat should push it to the top.
    await api
      .post(`/chat/${chatWithTwo}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'bump' });

    const response = await api.get(`/user/${USER_1}/chats`).set(authHeader(USER_1));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].chatId).toBe(chatWithTwo);
    expect(response.body.data[0].type).toBe('DIRECT');
    expect(response.body.data[0].members.sort()).toEqual([USER_1, USER_2].sort());
    expect(response.body.data[1].chatId).toBe(chatWithThree);
  });

  it('forbids listing another user\u2019s chats', async () => {
    const response = await request(ctx.app)
      .get(`/user/${USER_1}/chats`)
      .set(authHeader(USER_2));

    expect(response.status).toBe(403);
  });
});

describe('health check', () => {
  it('reports database status', async () => {
    const response = await request(ctx.app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });
});
