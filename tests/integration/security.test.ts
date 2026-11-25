import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../../src/config/database';
import { env } from '../../src/config/env';
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

describe('JWT authentication', () => {
  it('rejects requests without a token', async () => {
    const response = await request(ctx.app).get(`/user/${USER_1}/chats`);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
  });

  it('rejects a malformed Authorization header', async () => {
    const response = await request(ctx.app)
      .get(`/user/${USER_1}/chats`)
      .set('Authorization', 'Token abc');
    expect(response.status).toBe(401);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = jwt.sign({ email: 'attacker@example.com' }, 'wrong-secret', {
      subject: USER_1,
      issuer: 'chat-backend',
      expiresIn: '1h',
    });

    const response = await request(ctx.app)
      .get(`/user/${USER_1}/chats`)
      .set('Authorization', `Bearer ${forged}`);
    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({ email: 'aarav@example.com' }, env.JWT_SECRET, {
      subject: USER_1,
      issuer: 'chat-backend',
      expiresIn: -10,
    });

    const response = await request(ctx.app)
      .get(`/user/${USER_1}/chats`)
      .set('Authorization', `Bearer ${expired}`);
    expect(response.status).toBe(401);
  });
});

describe('impersonation attempts', () => {
  it('rejects a senderId that differs from the token subject', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);

    const response = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_2, text: 'I am totally Priya' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects marking a message read on behalf of another user', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);
    const sent = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'hello' });

    const response = await api
      .post(`/chat/${chatId}/message/${sent.body.data.messageId}/read`)
      .set(authHeader(USER_3))
      .send({ userId: USER_2 });

    expect(response.status).toBe(403);
  });

  it('rejects updating last seen on behalf of another user', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);
    const sent = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'hello' });

    const response = await api
      .post(`/chat/${chatId}/lastseen`)
      .set(authHeader(USER_2))
      .send({ userId: USER_1, messageId: sent.body.data.messageId });

    expect(response.status).toBe(403);
  });

  it('rejects listing another user\u2019s chats', async () => {
    const response = await request(ctx.app)
      .get(`/user/${USER_1}/chats`)
      .set(authHeader(USER_2));
    expect(response.status).toBe(403);
  });
});

describe('chat membership enforcement', () => {
  it('blocks non-members from reading, sending, marking read and last seen', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);
    const sent = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'private' });
    const messageId = sent.body.data.messageId as string;

    const reads = await Promise.all([
      api.get(`/chat/${chatId}/messages`).set(authHeader(USER_3)),
      api
        .post(`/chat/${chatId}/message/send`)
        .set(authHeader(USER_3))
        .send({ senderId: USER_3, text: 'intrusion' }),
      api
        .post(`/chat/${chatId}/message/${messageId}/read`)
        .set(authHeader(USER_3))
        .send({ userId: USER_3 }),
      api
        .post(`/chat/${chatId}/lastseen`)
        .set(authHeader(USER_3))
        .send({ userId: USER_3, messageId }),
      api.get(`/chat/${chatId}/members`).set(authHeader(USER_3)),
    ]);

    for (const response of reads) {
      expect(response.status).toBe(403);
    }
  });

  it('blocks non-members from editing or deleting a message', async () => {
    const api = request(ctx.app);
    const chatId = await createDirectChat(api, USER_1, USER_2);
    const sent = await api
      .post(`/chat/${chatId}/message/send`)
      .set(authHeader(USER_1))
      .send({ senderId: USER_1, text: 'private' });

    const edit = await api
      .patch(`/chat/${chatId}/message/${sent.body.data.messageId}`)
      .set(authHeader(USER_3))
      .send({ text: 'nope' });
    const remove = await api
      .delete(`/chat/${chatId}/message/${sent.body.data.messageId}`)
      .set(authHeader(USER_3));

    expect(edit.status).toBe(403);
    expect(remove.status).toBe(403);
  });
});

describe('group authorization', () => {
  async function setupGroup(api: ReturnType<typeof request>): Promise<string> {
    const response = await api
      .post('/chat/group/create')
      .set(authHeader(USER_1))
      .send({ name: 'Secure Group', participantIds: [USER_2, USER_3] });
    return response.body.data.chatId;
  }

  it('blocks non-members from adding or removing members', async () => {
    const api = request(ctx.app);
    const chatId = await setupGroup(api);

    const add = await api
      .post(`/chat/${chatId}/members`)
      .set(authHeader(USER_4))
      .send({ participantIds: [USER_5] });
    const remove = await api.delete(`/chat/${chatId}/members/${USER_2}`).set(authHeader(USER_4));

    expect(add.status).toBe(403);
    expect(remove.status).toBe(403);
  });

  it('blocks a regular member from removing the creator', async () => {
    const api = request(ctx.app);
    const chatId = await setupGroup(api);

    const response = await api.delete(`/chat/${chatId}/members/${USER_1}`).set(authHeader(USER_2));
    expect(response.status).toBe(403);
  });
});

describe('error handling', () => {
  it('returns a consistent 404 for unknown routes', async () => {
    const response = await request(ctx.app).get('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, code: 'NOT_FOUND' });
  });

  it('returns a consistent validation error shape', async () => {
    const response = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_1))
      .send({});

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(Array.isArray(response.body.details)).toBe(true);
  });

  it('rejects malformed JSON bodies', async () => {
    const response = await request(ctx.app)
      .post('/chat/create')
      .set(authHeader(USER_1))
      .set('Content-Type', 'application/json')
      .send('{"userAId": "broken"');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('never leaks stack traces or internal error details', async () => {
    const response = await request(ctx.app).get(`/user/${USER_1}/chats`);
    expect(response.body).not.toHaveProperty('stack');
    expect(JSON.stringify(response.body)).not.toMatch(/at Object\.|node_modules/);
  });
});
