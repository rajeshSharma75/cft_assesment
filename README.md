# Chat Backend

My submission for the backend assessment: a chat API built with **Node.js,
TypeScript (strict) and Express**, using **PostgreSQL** for users, chats and
memberships and **Firebase Firestore** for messages, read receipts and last-seen
state.

All six requested APIs are implemented, plus the three bonus features: group chats
with member management, message editing and soft deletion. I used raw SQL through
`pg` (no ORM), Zod for validation, JWT for auth, and Vitest + Supertest for tests.

## Quick start

You need Node.js 20+, PostgreSQL 13+ (I used AWS RDS) and Firebase Admin credentials.

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET and the Firebase values
npm run db:setup          # run the migration and seed five users
npm run dev               # http://localhost:3000, Swagger at /api-docs
```

Then try it:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"email":"aarav.sharma@example.com"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.token")

# create (or reuse) a direct chat between two seeded users
curl -X POST http://localhost:3000/chat/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"userAId":"11111111-1111-4111-8111-111111111111","userBId":"22222222-2222-4222-8222-222222222222"}'

# send a message (replace CHAT_ID with the id from above)
curl -X POST http://localhost:3000/chat/CHAT_ID/message/send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"senderId":"11111111-1111-4111-8111-111111111111","text":"Hello!"}'
```

If port 3000 is busy, set `PORT=3100` in `.env`.

## Features

- Deterministic **direct chat key** (`sortedUserIdA_sortedUserIdB`) plus a unique
index, so concurrent requests can never create duplicate 1:1 chats.
- PostgreSQL transactions for chat creation and membership writes; Firestore
transactions for receipts and last seen.
- Cursor pagination on `(createdAt, messageId)`, not offsets.
- JWT auth on every chat/user route; identity always comes from the token, never the
body, and membership is checked before any chat resource is touched.
- Centralized errors with one response envelope, Zod validation, Swagger UI.
- Dev-only token issuance for seeded users (there is no registration flow).



## Stack


| Purpose             | Technology                                  |
| ------------------- | ------------------------------------------- |
| Runtime / framework | Node.js 20+, Express 4                      |
| Language            | TypeScript 5 (strict)                       |
| Database / driver   | PostgreSQL 13+, `pg` (raw SQL)              |
| Message store       | Firebase Firestore (Admin SDK)              |
| Validation / auth   | Zod, JWT (`jsonwebtoken`)                   |
| Tests / docs        | Vitest, Supertest, Swagger UI + OpenAPI 3.0 |




## Architecture

```text
src/
├── config/          env validation, pg pool/transactions, Firebase bootstrap
├── modules/         auth, users, chats (chat + message services/repositories/routes)
├── middlewares/     JWT auth, Zod validation, error handler
├── validators/      Zod request schemas
├── utils/           AppError, response envelope, cursor codec, JWT helpers
├── docs/            OpenAPI document
├── database/        migration runner
├── app.ts           Express app factory (injects the message store)
└── server.ts        bootstrap + graceful shutdown
```

Flow: **route → validation → auth → controller → service → repository**. Controllers
only translate HTTP, rules live in services, SQL/Firestore access lives in
repositories. `MessageStore` is an interface with a Firestore implementation for the
app and an in-memory implementation for tests, injected via
`createApp({ messageStore })`.

## PostgreSQL schema

Migration: `[database/migrations/001_init.sql](database/migrations/001_init.sql)`.


| Table          | Key columns                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `users`        | `id` UUID PK, `name`, `email` unique, timestamps (trigger-maintained `updated_at`)                                                     |
| `chats`        | `id`, `name` (groups only), `type` `DIRECT`/`GROUP`, `direct_chat_key` unique, `created_by` FK → users, `last_activity_at`, timestamps |
| `chat_members` | `id`, `chat_id` FK → chats (cascade), `user_id` FK → users (cascade), `joined_at`, unique `(chat_id, user_id)`                         |


Check constraints enforce that direct chats have a key and no name, and that groups
have a name and no key. Indexes cover membership lookups and
`chats(last_activity_at DESC)`.

`last_activity_at` is an addition on purpose: listing chats by latest activity then
needs no Firestore read. Membership removal is a hard delete, so authorization always
sees active members only.

## Firestore structure

```text
chats/{chatId}/messages/{messageId}
  senderId, text, createdAt (server), editedAt, deletedAt, isDeleted

chats/{chatId}/messages/{messageId}/receipts/{userId}
  userId, status: "READ", readAt (server, never overwritten)

chats/{chatId}/members/{userId}
  lastSeenMessageId, lastSeenMessageCreatedAt, lastSeenAt
```

One receipt document per user per message. Ordering is `createdAt ASC` with the
document ID as tie-breaker, and cursors carry `{seconds, nanoseconds, messageId}` so
nanosecond precision survives paging. Messages are never written to PostgreSQL.

## Configuration

Copy `.env.example` to `.env` and set:


| Variable                  | Required | Description                                                                     |
| ------------------------- | -------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                | yes      | `development`, `test` or `production`                                           |
| `PORT`                    | no       | defaults to `3000`                                                              |
| `DATABASE_URL`            | yes      | PostgreSQL connection string (tests use it too)                                 |
| `DATABASE_SCHEMA`         | no       | defaults to `public`; tests set `chat_test` automatically                       |
| `JWT_SECRET`              | yes      | at least 16 characters                                                          |
| `JWT_EXPIRES_IN`          | no       | defaults to `1d`                                                                |
| `FIREBASE_PROJECT_ID`     | messages | service account `project_id`                                                    |
| `FIREBASE_CLIENT_EMAIL`   | messages | service account `client_email`                                                  |
| `FIREBASE_PRIVATE_KEY`    | messages | service account `private_key`                                                   |
| `FIRESTORE_DATABASE_ID`   | no       | defaults to `(default)`; set it if your project uses a named Firestore database |
| `FIRESTORE_EMULATOR_HOST` | no       | e.g. `localhost:8080` for the local emulator                                    |


Startup fails fast if `DATABASE_URL` or `JWT_SECRET` is missing. `.env` is
git-ignored; only `.env.example` is committed.

### Getting the Firebase credentials

1. Open the [Firebase console](https://console.firebase.google.com) and create a
  project (or pick an existing one).
2. **Build → Firestore Database → Create database**, choose **Native mode** and a
  region. If you give the database a custom ID instead of accepting
   `(default)`, copy that ID into `FIRESTORE_DATABASE_ID`.
3. **Project settings → Service accounts → Generate new private key**. A JSON file
  downloads.
4. Copy three fields from that JSON into `.env`:
  ```env
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
  ```
   Keep the `\n` sequences and the surrounding quotes exactly as they appear in the
   JSON; the app converts them to real newlines at startup.
5. Never commit the JSON file. `.gitignore` blocks `serviceAccount*.json`, and the app
  reads credentials only from the environment.

The Admin SDK bypasses Firestore security rules, so existing rules neither help nor
block this backend; if no client app uses Firestore, keep them deny-all. No composite
indexes are needed (one field plus the implicit document-name order).

If credentials are missing the server still starts with a warning, and message
endpoints return `503 SERVICE_UNAVAILABLE` — that is the quickest way to spot a bad
setup.

## Database setup

One database is enough. If you already have one (my case, on AWS RDS), just point
`DATABASE_URL` at it and skip this. To create one locally:

```bash
createdb chat_db    # or: psql -U postgres -c "CREATE DATABASE chat_db;"
```

Then let the code do the rest:

```bash
npm run migrate   # applies database/migrations/*.sql once each, in a transaction
npm run seed      # five fixed users, idempotent by email
npm run db:setup  # both
```


| Name         | Email                                                       | UUID                                   |
| ------------ | ----------------------------------------------------------- | -------------------------------------- |
| Aarav Sharma | [aarav.sharma@example.com](mailto:aarav.sharma@example.com) | `11111111-1111-4111-8111-111111111111` |
| Priya Patel  | [priya.patel@example.com](mailto:priya.patel@example.com)   | `22222222-2222-4222-8222-222222222222` |
| Rahul Verma  | [rahul.verma@example.com](mailto:rahul.verma@example.com)   | `33333333-3333-4333-8333-333333333333` |
| Sneha Iyer   | [sneha.iyer@example.com](mailto:sneha.iyer@example.com)     | `44444444-4444-4444-8444-444444444444` |
| Vikram Singh | [vikram.singh@example.com](mailto:vikram.singh@example.com) | `55555555-5555-4555-8555-555555555555` |




## Running

```bash
npm run dev     # auto-reload
npm run build   # compile to dist/
npm start       # run the build
```

- API: `http://localhost:3000`
- Swagger UI: `/api-docs` · OpenAPI JSON: `/api-docs.json`
- Health: `/health`



## Auth and tokens

`/auth/dev-token` and `npm run token` are disabled when `NODE_ENV=production`; there a
real identity provider would sign the same payload (`sub`, `email`).

```bash
curl -X POST http://localhost:3000/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"email":"aarav.sharma@example.com"}'

npm run token -- aarav.sharma@example.com
```

Send the token as `Authorization: Bearer <TOKEN>` on every chat/user route.

## Endpoints


| Method | Path                                    | Description                   |
| ------ | --------------------------------------- | ----------------------------- |
| POST   | `/chat/create`                          | Create or get a 1:1 chat      |
| POST   | `/chat/group/create`                    | Create a group chat           |
| POST   | `/chat/:chatId/message/send`            | Send a message                |
| GET    | `/chat/:chatId/messages?limit=&cursor=` | List messages chronologically |
| POST   | `/chat/:chatId/message/:messageId/read` | Mark a message read           |
| POST   | `/chat/:chatId/lastseen`                | Update last-seen message      |
| GET    | `/user/:userId/chats`                   | List a user's chats           |
| GET    | `/chat/:chatId/members`                 | List members                  |
| POST   | `/chat/:chatId/members`                 | Add group members             |
| DELETE | `/chat/:chatId/members/:userId`         | Remove a member / leave group |
| PATCH  | `/chat/:chatId/message/:messageId`      | Edit a message                |
| DELETE | `/chat/:chatId/message/:messageId`      | Soft-delete a message         |
| POST   | `/auth/dev-token`                       | Issue a development JWT       |
| GET    | `/users`                                | List seeded users             |


All chat/user routes need `Authorization: Bearer <JWT>`; full schemas and examples
are in Swagger.

## Testing

```bash
npm test
npm run test:watch
```

There is no separate test database. The suite uses the same `DATABASE_URL` and works
inside a dedicated `chat_test` **schema** (created on first run). Only that schema is
migrated and truncated between tests, so your `public` tables and data stay untouched.
If the connection is not on the expected schema, the suite aborts before changing
anything. On a restricted database the user needs `CREATE SCHEMA`; otherwise point
`DATABASE_SCHEMA` at a schema you already own.

Last run: **116 passed, 0 failed, 8 skipped** (9 files passed, 1 skipped).

The 8 skipped tests are the optional Firestore emulator suite; it runs when
`FIRESTORE_EMULATOR_HOST` is set, and I skipped it because the emulator needs Java and
the Firebase CLI.

```bash
npx firebase-tools emulators:start --only firestore --project demo-chat
FIRESTORE_EMULATOR_HOST=localhost:8080 npm test -- firestore.emulator
```

The suite covers unit tests with mocked repositories, Supertest tests for every
original and bonus endpoint, PostgreSQL constraint/transaction/concurrency tests, and
security tests for bad tokens, impersonation, non-member access and unauthorized
group changes.

## Design decisions and limitations

- **No cross-database transaction.** After a message is written I update
`chats.last_activity_at`; if that fails the message stays and the error is logged.
The API never claims Firestore + PostgreSQL atomicity.
- **Message deduplication** uses an optional `Idempotency-Key` header (or
`idempotencyKey` body field): the document ID is `sha256(chatId:key)`, created with
Firestore `create()`, so retries return the original message.
- **Ordering ties** use the document ID (UUID): deterministic, though two messages in
the same nanosecond may not match wall-clock order.
- **Last seen** compares `lastSeenMessageCreatedAt` (message position) so it can never
move backwards; `lastSeenAt` records when the update happened.
- **Read receipts** are per message per user and never overwritten.
- **No real-time transport** — clients poll. Group renaming and deleting chats are out
of scope. No app-level rate limiting; put that at the gateway.
- Swagger is intentionally unauthenticated. `npm run lint` aliases `tsc --noEmit`
(no separate ESLint config).



## Project layout

```text
database/migrations/001_init.sql   database/seeds/001_users.sql
scripts/migrate.ts  scripts/seed.ts  scripts/generate-token.ts
src/     application code (see Architecture)
tests/   unit/, integration/, helpers/, setup.ts
.env.example  .gitignore  package.json  tsconfig*.json  vitest.config.ts
```

