import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import { signUserToken } from '../../src/utils/jwt';
import { InMemoryMessageStore } from './in-memory-message-store';

export interface TestContext {
  app: Express;
  store: InMemoryMessageStore;
}

export function createTestContext(): TestContext {
  const store = new InMemoryMessageStore();
  const app = createApp({ messageStore: store });
  return { app, store };
}

export function tokenFor(userId: string, email = `${userId}@example.com`): string {
  return signUserToken({ id: userId, email });
}

export function authHeader(userId: string, email?: string): { Authorization: string } {
  return { Authorization: `Bearer ${tokenFor(userId, email ?? `${userId}@example.com`)}` };
}

/** Convenience: create a direct chat and return its id. */
export async function createDirectChat(
  api: ReturnType<typeof request>,
  actorId: string,
  otherId: string,
): Promise<string> {
  const response = await api
    .post('/chat/create')
    .set(authHeader(actorId))
    .send({ userAId: actorId, userBId: otherId });

  if (response.status !== 200) {
    throw new Error(`Failed to create chat: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return response.body.data.chatId as string;
}
