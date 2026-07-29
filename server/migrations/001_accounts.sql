CREATE TABLE users (
  id uuid PRIMARY KEY,
  username varchar(24) NOT NULL,
  username_key varchar(24) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT users_username_format
    CHECK (username ~ '^[A-Za-z0-9_]{3,24}$'),
  CONSTRAINT users_username_key_lowercase
    CHECK (username_key = lower(username_key))
);

CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT sessions_token_hash_length
    CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessions_expiry_order
    CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
