CREATE INDEX users_created_at_idx
  ON users (created_at DESC, id DESC);

CREATE INDEX users_username_key_prefix_idx
  ON users (username_key varchar_pattern_ops);

CREATE INDEX match_history_participants_username_prefix_idx
  ON match_history_participants (lower(username) varchar_pattern_ops, match_id);
