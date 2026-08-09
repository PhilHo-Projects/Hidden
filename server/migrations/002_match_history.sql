CREATE TABLE match_history_records (
  id uuid PRIMARY KEY,
  schema_version smallint NOT NULL,
  completed_at timestamptz NOT NULL,
  engine_id text NOT NULL,
  engine_revision integer NOT NULL,
  config_snapshot jsonb NOT NULL,
  turn_count integer NOT NULL,
  winner_seat smallint,
  seat_0_score integer NOT NULL,
  seat_1_score integer NOT NULL,
  final_boards jsonb NOT NULL,
  CONSTRAINT match_history_schema_version_v1 CHECK (schema_version = 1),
  CONSTRAINT match_history_engine_revision_positive CHECK (engine_revision > 0),
  CONSTRAINT match_history_turn_count_nonnegative CHECK (turn_count >= 0),
  CONSTRAINT match_history_winner_seat CHECK (winner_seat IS NULL OR winner_seat IN (0, 1)),
  CONSTRAINT match_history_scores_nonnegative CHECK (seat_0_score >= 0 AND seat_1_score >= 0),
  CONSTRAINT match_history_config_object CHECK (jsonb_typeof(config_snapshot) = 'object'),
  CONSTRAINT match_history_boards_array CHECK (jsonb_typeof(final_boards) = 'array')
);

CREATE INDEX match_history_records_completed_idx
  ON match_history_records (completed_at DESC, id DESC);

CREATE TABLE match_history_participants (
  match_id uuid NOT NULL REFERENCES match_history_records(id) ON DELETE CASCADE,
  seat smallint NOT NULL,
  account_id uuid REFERENCES users(id) ON DELETE SET NULL,
  username varchar(24) NOT NULL,
  PRIMARY KEY (match_id, seat),
  UNIQUE (match_id, account_id),
  CONSTRAINT match_history_participant_seat CHECK (seat IN (0, 1))
);

CREATE INDEX match_history_participants_account_idx
  ON match_history_participants (account_id, match_id)
  WHERE account_id IS NOT NULL;

CREATE TABLE match_history_bookmarks (
  match_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (match_id, user_id),
  FOREIGN KEY (match_id, user_id)
    REFERENCES match_history_participants(match_id, account_id)
    ON DELETE CASCADE
);
