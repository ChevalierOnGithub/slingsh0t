CREATE TABLE IF NOT EXISTS id_counters (type TEXT PRIMARY KEY, next INTEGER NOT NULL);
INSERT OR IGNORE INTO id_counters (type, next) VALUES ('H', 1), ('T', 1), ('TQ', 1), ('TL', 1);

CREATE TABLE IF NOT EXISTS boxes (
  id INTEGER PRIMARY KEY,
  short_id TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('HTB','THM')),
  name TEXT NOT NULL,
  os TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard','Insane')),
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','user_flag','rooted')),
  target_ip TEXT,
  next_step TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  rooted_at TEXT,
  source_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lhost TEXT NOT NULL DEFAULT '',
  lport TEXT NOT NULL DEFAULT '',
  active_box_id INTEGER REFERENCES boxes(id) ON DELETE SET NULL
);
INSERT OR IGNORE INTO context (id) VALUES (1);

CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY,
  box_id INTEGER NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ({{PHASES}})),
  position INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  timer_started_at INTEGER
);

CREATE TABLE IF NOT EXISTS techniques (
  id INTEGER PRIMARY KEY,
  short_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ({{PHASES}})),
  description TEXT NOT NULL DEFAULT '',
  source_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS tools (
  id INTEGER PRIMARY KEY,
  short_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  source_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS technique_tools (
  technique_id INTEGER NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
  tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  PRIMARY KEY (technique_id, tool_id)
);

CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY,
  tool_id INTEGER REFERENCES tools(id) ON DELETE CASCADE,
  technique_id INTEGER REFERENCES techniques(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL,
  procedure_key TEXT,
  position INTEGER,
  source_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS technique_uses (
  id INTEGER PRIMARY KEY,
  technique_id INTEGER NOT NULL REFERENCES techniques(id) ON DELETE CASCADE,
  step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  tool_ids TEXT,
  UNIQUE (technique_id, step_id)
);

CREATE TABLE IF NOT EXISTS reference_pages (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS unsorted (
  id INTEGER PRIMARY KEY,
  source_page TEXT NOT NULL,
  content TEXT NOT NULL,
  source_id TEXT UNIQUE
);
