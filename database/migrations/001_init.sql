-- ---------------------------------------------------------------------------
-- 001_init.sql
-- Users, chats and chat membership live in PostgreSQL. Messages, read receipts
-- and last-seen state live in Firestore (see README).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS chats (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100),
  type             VARCHAR(10) NOT NULL,
  direct_chat_key  VARCHAR(100),
  created_by       UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chats_type_valid CHECK (type IN ('DIRECT', 'GROUP')),
  -- A direct chat must have a deterministic key; a group must not.
  CONSTRAINT chats_direct_key_matches_type CHECK (
    (type = 'DIRECT' AND direct_chat_key IS NOT NULL)
    OR (type = 'GROUP' AND direct_chat_key IS NULL)
  ),
  -- Group chats must be named.
  CONSTRAINT chats_group_has_name CHECK (type <> 'GROUP' OR name IS NOT NULL)
);

-- Unique index is what makes concurrent direct-chat creation safe.
CREATE UNIQUE INDEX IF NOT EXISTS chats_direct_chat_key_unique
  ON chats (direct_chat_key);

CREATE TABLE IF NOT EXISTS chat_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    UUID NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_members_unique UNIQUE (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id ON chat_members (chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members (user_id);
CREATE INDEX IF NOT EXISTS idx_chats_last_activity_at ON chats (last_activity_at DESC);

-- Keep updated_at accurate at the database level.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS chats_set_updated_at ON chats;
CREATE TRIGGER chats_set_updated_at
  BEFORE UPDATE ON chats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
