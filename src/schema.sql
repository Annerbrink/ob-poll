CREATE TABLE IF NOT EXISTS polls (
  id          TEXT PRIMARY KEY,
  home_team   TEXT NOT NULL,
  away_team   TEXT NOT NULL,
  kickoff     TEXT,
  closes_at   TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  poll_id    TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  voter_id   TEXT NOT NULL,
  choice     TEXT NOT NULL CHECK (choice IN ('1', 'X', '2')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (poll_id, voter_id)
);

CREATE INDEX IF NOT EXISTS votes_by_poll ON votes (poll_id, choice);
