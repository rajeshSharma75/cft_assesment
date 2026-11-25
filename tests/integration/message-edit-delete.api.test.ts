import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../../src/config/database';
import { authHeader, createDirectChat, createTestContext, TestContext } from '../helpers/test-app';
import { resetAndSeed, USER_1, USER_2 } from '../helpers/database';

let ctx: TestContext;

beforeEach(async () => {
  await resetAndSeed();
  ctx = createTestContext();
});

afterAll(async () => {
  await closePool();
});

async function setupMessage(api: ReturnType<typeof request>) {
  const chatId = await createDirectChat(api, USER_1, USER_2);
  const sent = await api
    .post(`/chat/${chatId}/message/send`)
    .set(authHeader(USER_1))
    .send({ senderId: USER_1, text: 'Original text' });

  return { chatId, message: sent.body.data as { messageId: string; createdAt: string } };
}

describe('Bonus: PATCH /chat/:chatId/message/:messageId', () => {
  it('lets the sender edit text and sets editedAt while preserving createdAt', async () => {
    const api = request(ctx.app);
    const { chatId, message } = await setupMessage(api);

    const response = await api
      .patch(`/chat/${chatId}/message/${message.messageId}`)
      .set(authHeader(USER_1))
      .send({ text: 'Updated message' });

    expect(response.status).toBe(200);
    expect(response.body.data.text).toBe('Updated message');
    expect(response.body.data.createdAt).toBe(message.createdAt);
    expect(response.body.data.editedAt).toEqual(expect.any(String));
  });

  it('forbids editing another user\u2019s message', async () => {
    const api = request(ctx.app);
    const { chatId, message } = await setupMessage(api);

    const response = await api
      .patch(`/chat/${chatId}/message/${message.messageId}`)
      .set(authHeader(USER_2))
      .send({ text: 'hacked' });

    expect(response.status).toBe(403);
  });

  it('prevents editing deleted messages', async () => {
    const api = request(ctx.app);
    const { chatId, message } = await setupMessage(api);

    await api.delete(`/chat/${chatId}/message/${message.messageId}`).set(authHeader(USER_1));

    const response = await api
      .patch(`/chat/${chatId}/message/${message.messageId}`)
      .set(authHeader(USER_1))
      .send({ text: 'revived' });

    expect(response.status).toBe(409);
  });

  it('returns 404 for an unknown message', async () => {
    const api = request(ctx.app);
    const { chatId } = await setupMessage(api);

    const response = await api
      .patch(`/chat/${chatId}/message/does-not-exist`)
      .set(authHeader(USER_1))
      .send({ text: 'hello' });

    expect(response.status).toBe(404);
  });

  it('validates the new text', async () => {
    const api = request(ctx.app);
    const { chatId, message } = await setupMessage(api);

    const response = await api
      .patch(`/chat/${chatId}/message/${message.messageId}`)
      .set(authHeader(USER_1))
      .send({ text: '   ' });

    expect(response.status).toBe(422);
  });
});

describe('Bonus: DELETE /chat/:chatId/message/:messageId', () => {
  it('soft deletes, clears text and keeps a placeholder in the history', async () => {
    const api = request(ctx.app);
    const { chatId, message } = await setupMessage(api);

    const response = await api
      .delete(`/chat/${chatId}/message/${message.messageId}`)
      .set(authHeader(USER_1));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      messageId: message.messageId,
      text: null,
      isDeleted: true,
    });
    expect(response.body.data.deletedAt).toEqual(expect.any(String));

    const list = await api.get(`/chat/${chatId}/messages`).set(authHeader(USER_2));
    expect(list.body.data.messages[0]).toMatchObject({ text: null, isDeleted: true });
  });

  it('forbids deleting another user\u2019s message', async () => {
    const api = request(ctx.app);
    const { chatId, message } = await setupMessage(api);

    const response = await api
      .delete(`/chat/${chatId}/message/${message.messageId}`)
      .set(authHeader(USER_2));

    expect(response.status).toBe(403);
  });

  it('is idempotent and preserves the first deletedAt', async () => {
    const api = request(ctx.app);
    const { chatId, message } = await setupMessage(api);

    const first = await api
      .delete(`/chat/${chatId}/message/${message.messageId}`)
      .set(authHeader(USER_1));
    const second = await api
      .delete(`/chat/${chatId}/message/${message.messageId}`)
      .set(authHeader(USER_1));

    expect(second.status).toBe(200);
    expect(second.body.data.deletedAt).toBe(first.body.data.deletedAt);
  });
});
