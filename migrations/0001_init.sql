CREATE TABLE IF NOT EXISTS polls (
  id          TEXT PRIMARY KEY,
  home_team   TEXT NOT NULL,
  away_team   TEXT NOT NULL,
  kickoff     TEXT,
  closes_at   TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,

  -- Whether the fixture is a men's ('herr') or women's ('dam') match, so the
  -- widget can label it. NULL for polls created before the column existed.
  category    TEXT,

  -- Running tally, kept in step with the votes table inside the same
  -- transaction. Reading a result is then one row instead of a scan over
  -- every vote, which is what keeps the poll inside a metered database's
  -- row-read budget however popular the match gets.
  count_1     INTEGER NOT NULL DEFAULT 0,
  count_x     INTEGER NOT NULL DEFAULT 0,
  count_2     INTEGER NOT NULL DEFAULT 0
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
