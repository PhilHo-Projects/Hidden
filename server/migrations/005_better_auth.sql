-- Existing accounts are intentionally disposable. Delete them while the
-- legacy foreign keys still exist so sessions and bookmarks cascade away and
-- match participant account links become null without touching snapshots.
DELETE FROM users;

DROP TABLE sessions;
DROP INDEX users_username_key_prefix_idx;

ALTER TABLE users
  RENAME COLUMN username TO display_username;

ALTER TABLE users
  DROP CONSTRAINT users_username_format,
  DROP COLUMN username_key,
  DROP COLUMN password_hash,
  ADD COLUMN name text NOT NULL,
  ADD COLUMN email text NOT NULL,
  ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN image text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN username varchar(24) NOT NULL,
  ADD COLUMN role text NOT NULL DEFAULT 'player';

ALTER TABLE users
  ALTER COLUMN last_seen_at SET DEFAULT now(),
  ADD CONSTRAINT users_email_unique UNIQUE (email),
  ADD CONSTRAINT users_username_unique UNIQUE (username),
  ADD CONSTRAINT users_username_format
    CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  ADD CONSTRAINT users_username_lowercase
    CHECK (username = lower(username)),
  ADD CONSTRAINT users_username_matches_display
    CHECK (username = lower(display_username)),
  ADD CONSTRAINT users_display_username_format
    CHECK (display_username ~ '^[A-Za-z0-9_]{3,24}$'),
  ADD CONSTRAINT users_role
    CHECK (role IN ('player', 'admin'));

CREATE INDEX users_username_prefix_idx
  ON users (username varchar_pattern_ops);

CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY,
  issuer text NOT NULL,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_accounts_issuer_account_unique
    UNIQUE (issuer, account_id)
);

CREATE INDEX auth_accounts_user_id_idx
  ON auth_accounts (user_id);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX auth_sessions_user_id_idx
  ON auth_sessions (user_id);

CREATE INDEX auth_sessions_expires_at_idx
  ON auth_sessions (expires_at);

CREATE TABLE auth_verifications (
  id uuid PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_verifications_identifier_idx
  ON auth_verifications (identifier);

CREATE INDEX auth_verifications_expires_at_idx
  ON auth_verifications (expires_at);

CREATE TABLE auth_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL,
  CONSTRAINT auth_rate_limits_count_nonnegative CHECK (count >= 0)
);

CREATE INDEX auth_rate_limits_last_request_idx
  ON auth_rate_limits (last_request);
