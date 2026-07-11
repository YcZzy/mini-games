PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pvp_rooms (
  code TEXT PRIMARY KEY,
  host_player_id TEXT NOT NULL,
  guest_player_id TEXT,
  status TEXT NOT NULL DEFAULT 'lobby',
  seed INTEGER NOT NULL,
  winner_player_id TEXT,
  loser_player_id TEXT,
  result_reason TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (host_player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (guest_player_id) REFERENCES players(id) ON DELETE SET NULL,
  FOREIGN KEY (winner_player_id) REFERENCES players(id) ON DELETE SET NULL,
  FOREIGN KEY (loser_player_id) REFERENCES players(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_rooms_expiry ON pvp_rooms(expires_at);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_host ON pvp_rooms(host_player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_guest ON pvp_rooms(guest_player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pvp_matches (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL UNIQUE,
  winner_player_id TEXT NOT NULL,
  loser_player_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  winner_wave INTEGER NOT NULL DEFAULT 0,
  loser_wave INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  FOREIGN KEY (winner_player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (loser_player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_matches_winner ON pvp_matches(winner_player_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_loser ON pvp_matches(loser_player_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS pvp_stats (
  player_id TEXT PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
