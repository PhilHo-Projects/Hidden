ALTER TABLE users
  ADD COLUMN last_seen_at timestamptz;

UPDATE users AS account
SET last_seen_at = COALESCE(
  (
    SELECT max(session.last_seen_at)
    FROM sessions AS session
    WHERE session.user_id = account.id
  ),
  account.created_at
);

ALTER TABLE users
  ALTER COLUMN last_seen_at SET NOT NULL;
