import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../../src/config/database';
import { authHeader, createTestContext, TestContext } from '../helpers/test-app';
import { resetAndSeed, TEST_USERS, USER_1, USER_2 } from '../helpers/database';

let ctx: TestContext;

beforeEach(async () => {
  await resetAndSeed();
  ctx = createTestContext();
});

afterAll(async () => {
  await closePool();
});

describe('POST /auth/dev-token', () => {
  it('issues a working token for a seeded user', async () => {
    const seedUser = TEST_USERS[0];

    const tokenResponse = await request(ctx.app)
      .post('/auth/dev-token')
      .send({ email: seedUser.email });

    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.body.data.token).toEqual(expect.any(String));
    expect(tokenResponse.body.data.user).toMatchObject({
      id: seedUser.id,
      email: seedUser.email,
    });

    const meResponse = await request(ctx.app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenResponse.body.data.token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data).toMatchObject({ id: seedUser.id, email: seedUser.email });
  });

  it('returns 404 for an unknown email', async () => {
    const response = await request(ctx.app)
      .post('/auth/dev-token')
      .send({ email: 'nobody@example.com' });

    expect(response.status).toBe(404);
  });

  it('validates the email format', async () => {
    const response = await request(ctx.app)
      .post('/auth/dev-token')
      .send({ email: 'not-an-email' });

    expect(response.status).toBe(422);
  });
});

describe('user endpoints', () => {
  it('lists seeded users for authenticated callers', async () => {
    const response = await request(ctx.app).get('/users').set(authHeader(USER_1));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(TEST_USERS.length);
  });

  it('requires authentication to list users', async () => {
    const response = await request(ctx.app).get('/users');
    expect(response.status).toBe(401);
  });

  it('returns your own user record', async () => {
    const response = await request(ctx.app).get(`/users/${USER_1}`).set(authHeader(USER_1));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: USER_1,
      email: TEST_USERS[0].email,
    });
  });

  it('forbids reading another user record', async () => {
    const response = await request(ctx.app).get(`/users/${USER_2}`).set(authHeader(USER_1));
    expect(response.status).toBe(403);
  });
});
