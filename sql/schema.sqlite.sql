-- 智慧社区治理平台 · SQLite 生产库结构（自动生成，勿手工编辑）
-- 提升列 + JSON 文档表；org_code / grid_code 前缀索引承载四级数据权限
-- SQLite 3.35+ (需 JSON1 / FTS5 trigram)，本环境 SQLite 3.51.2

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- 令牌吊销名单（logout / 改密即时失效）
CREATE TABLE IF NOT EXISTS auth_revoked (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL, reason TEXT, revoked_at TEXT);
CREATE INDEX IF NOT EXISTS idx_auth_revoked_exp ON auth_revoked(exp);

-- 菜单与角色权限（正式版权限驱动，替代硬编码）
CREATE TABLE IF NOT EXISTS sys_menu (menu_key TEXT PRIMARY KEY, parent_key TEXT, title TEXT, path TEXT, icon TEXT, module TEXT, sort_no INTEGER);
CREATE TABLE IF NOT EXISTS sys_role_menu (role TEXT NOT NULL, menu_key TEXT NOT NULL, PRIMARY KEY (role, menu_key));

-- 居民端查询凭条：只存业务编号 + 手机号哈希 + 查询码哈希，不存明文
CREATE TABLE IF NOT EXISTS resident_query (biz_id TEXT PRIMARY KEY, biz_code TEXT NOT NULL, code_hash TEXT NOT NULL, phone_hash TEXT NOT NULL, created_at TEXT);

-- 居民端查询失败计数：防止 6 位查询码被暴力枚举（按 业务编号+来源 锁定）
CREATE TABLE IF NOT EXISTS resident_attempt (attempt_key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, updated_at TEXT);

CREATE TABLE IF NOT EXISTS "t_users" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_users_org"    ON "t_users"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_users_grid"   ON "t_users"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_users_status" ON "t_users"(status);
CREATE INDEX IF NOT EXISTS "idx_t_users_phone"  ON "t_users"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_orgs" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_orgs_org"    ON "t_orgs"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_orgs_grid"   ON "t_orgs"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_orgs_status" ON "t_orgs"(status);
CREATE INDEX IF NOT EXISTS "idx_t_orgs_phone"  ON "t_orgs"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_grids" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_grids_org"    ON "t_grids"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_grids_grid"   ON "t_grids"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_grids_status" ON "t_grids"(status);
CREATE INDEX IF NOT EXISTS "idx_t_grids_phone"  ON "t_grids"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_persons" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_persons_org"    ON "t_persons"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_persons_grid"   ON "t_persons"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_persons_status" ON "t_persons"(status);
CREATE INDEX IF NOT EXISTS "idx_t_persons_phone"  ON "t_persons"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_opLogs" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_opLogs_org"    ON "t_opLogs"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_opLogs_grid"   ON "t_opLogs"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_opLogs_status" ON "t_opLogs"(status);
CREATE INDEX IF NOT EXISTS "idx_t_opLogs_phone"  ON "t_opLogs"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_flowLogs" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_flowLogs_org"    ON "t_flowLogs"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_flowLogs_grid"   ON "t_flowLogs"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_flowLogs_status" ON "t_flowLogs"(status);
CREATE INDEX IF NOT EXISTS "idx_t_flowLogs_phone"  ON "t_flowLogs"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_partyOrgs" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_partyOrgs_org"    ON "t_partyOrgs"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_partyOrgs_grid"   ON "t_partyOrgs"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_partyOrgs_status" ON "t_partyOrgs"(status);
CREATE INDEX IF NOT EXISTS "idx_t_partyOrgs_phone"  ON "t_partyOrgs"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_partyMembers" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_partyMembers_org"    ON "t_partyMembers"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_partyMembers_grid"   ON "t_partyMembers"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_partyMembers_status" ON "t_partyMembers"(status);
CREATE INDEX IF NOT EXISTS "idx_t_partyMembers_phone"  ON "t_partyMembers"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_honors" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_honors_org"    ON "t_honors"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_honors_grid"   ON "t_honors"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_honors_status" ON "t_honors"(status);
CREATE INDEX IF NOT EXISTS "idx_t_honors_phone"  ON "t_honors"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_memberFlows" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_memberFlows_org"    ON "t_memberFlows"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_memberFlows_grid"   ON "t_memberFlows"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_memberFlows_status" ON "t_memberFlows"(status);
CREATE INDEX IF NOT EXISTS "idx_t_memberFlows_phone"  ON "t_memberFlows"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_meetings" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_meetings_org"    ON "t_meetings"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_meetings_grid"   ON "t_meetings"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_meetings_status" ON "t_meetings"(status);
CREATE INDEX IF NOT EXISTS "idx_t_meetings_phone"  ON "t_meetings"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_learnings" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_learnings_org"    ON "t_learnings"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_learnings_grid"   ON "t_learnings"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_learnings_status" ON "t_learnings"(status);
CREATE INDEX IF NOT EXISTS "idx_t_learnings_phone"  ON "t_learnings"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_learningProgress" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_learningProgress_org"    ON "t_learningProgress"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_learningProgress_grid"   ON "t_learningProgress"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_learningProgress_status" ON "t_learningProgress"(status);
CREATE INDEX IF NOT EXISTS "idx_t_learningProgress_phone"  ON "t_learningProgress"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_historyLearn" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_historyLearn_org"    ON "t_historyLearn"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_historyLearn_grid"   ON "t_historyLearn"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_historyLearn_status" ON "t_historyLearn"(status);
CREATE INDEX IF NOT EXISTS "idx_t_historyLearn_phone"  ON "t_historyLearn"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_enterprises" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_enterprises_org"    ON "t_enterprises"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_enterprises_grid"   ON "t_enterprises"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_enterprises_status" ON "t_enterprises"(status);
CREATE INDEX IF NOT EXISTS "idx_t_enterprises_phone"  ON "t_enterprises"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_communities" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_communities_org"    ON "t_communities"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_communities_grid"   ON "t_communities"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_communities_status" ON "t_communities"(status);
CREATE INDEX IF NOT EXISTS "idx_t_communities_phone"  ON "t_communities"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_messages" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_messages_org"    ON "t_messages"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_messages_grid"   ON "t_messages"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_messages_status" ON "t_messages"(status);
CREATE INDEX IF NOT EXISTS "idx_t_messages_phone"  ON "t_messages"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_banners" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_banners_org"    ON "t_banners"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_banners_grid"   ON "t_banners"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_banners_status" ON "t_banners"(status);
CREATE INDEX IF NOT EXISTS "idx_t_banners_phone"  ON "t_banners"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_shortcuts" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_shortcuts_org"    ON "t_shortcuts"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_shortcuts_grid"   ON "t_shortcuts"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_shortcuts_status" ON "t_shortcuts"(status);
CREATE INDEX IF NOT EXISTS "idx_t_shortcuts_phone"  ON "t_shortcuts"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_recommends" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_recommends_org"    ON "t_recommends"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_recommends_grid"   ON "t_recommends"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_recommends_status" ON "t_recommends"(status);
CREATE INDEX IF NOT EXISTS "idx_t_recommends_phone"  ON "t_recommends"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_contents" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_contents_org"    ON "t_contents"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_contents_grid"   ON "t_contents"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_contents_status" ON "t_contents"(status);
CREATE INDEX IF NOT EXISTS "idx_t_contents_phone"  ON "t_contents"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_serviceRequests" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_serviceRequests_org"    ON "t_serviceRequests"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_serviceRequests_grid"   ON "t_serviceRequests"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_serviceRequests_status" ON "t_serviceRequests"(status);
CREATE INDEX IF NOT EXISTS "idx_t_serviceRequests_phone"  ON "t_serviceRequests"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_governanceEvents" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_governanceEvents_org"    ON "t_governanceEvents"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_governanceEvents_grid"   ON "t_governanceEvents"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_governanceEvents_status" ON "t_governanceEvents"(status);
CREATE INDEX IF NOT EXISTS "idx_t_governanceEvents_phone"  ON "t_governanceEvents"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_devices" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_devices_org"    ON "t_devices"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_devices_grid"   ON "t_devices"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_devices_status" ON "t_devices"(status);
CREATE INDEX IF NOT EXISTS "idx_t_devices_phone"  ON "t_devices"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_alarms" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_alarms_org"    ON "t_alarms"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_alarms_grid"   ON "t_alarms"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_alarms_status" ON "t_alarms"(status);
CREATE INDEX IF NOT EXISTS "idx_t_alarms_phone"  ON "t_alarms"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_workOrders" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_workOrders_org"    ON "t_workOrders"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_workOrders_grid"   ON "t_workOrders"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_workOrders_status" ON "t_workOrders"(status);
CREATE INDEX IF NOT EXISTS "idx_t_workOrders_phone"  ON "t_workOrders"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_contracts" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_contracts_org"    ON "t_contracts"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_contracts_grid"   ON "t_contracts"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_contracts_status" ON "t_contracts"(status);
CREATE INDEX IF NOT EXISTS "idx_t_contracts_phone"  ON "t_contracts"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_population" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_population_org"    ON "t_population"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_population_grid"   ON "t_population"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_population_status" ON "t_population"(status);
CREATE INDEX IF NOT EXISTS "idx_t_population_phone"  ON "t_population"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_houses" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_houses_org"    ON "t_houses"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_houses_grid"   ON "t_houses"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_houses_status" ON "t_houses"(status);
CREATE INDEX IF NOT EXISTS "idx_t_houses_phone"  ON "t_houses"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_buildings" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_buildings_org"    ON "t_buildings"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_buildings_grid"   ON "t_buildings"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_buildings_status" ON "t_buildings"(status);
CREATE INDEX IF NOT EXISTS "idx_t_buildings_phone"  ON "t_buildings"(sec_phone);

CREATE TABLE IF NOT EXISTS "t_parts" (
  id          TEXT PRIMARY KEY,
  org_code    TEXT NOT NULL DEFAULT '',
  grid_code   TEXT NOT NULL DEFAULT '',
  status      TEXT,
  name        TEXT,
  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索
  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解
  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配
  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引
  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁
);
CREATE INDEX IF NOT EXISTS "idx_t_parts_org"    ON "t_parts"(org_code);
CREATE INDEX IF NOT EXISTS "idx_t_parts_grid"   ON "t_parts"(grid_code);
CREATE INDEX IF NOT EXISTS "idx_t_parts_status" ON "t_parts"(status);
CREATE INDEX IF NOT EXISTS "idx_t_parts_phone"  ON "t_parts"(sec_phone);

-- FTS5 全文检索：替代 ElasticSearch，覆盖数据全景四页签与跨实体综合查询
CREATE VIRTUAL TABLE IF NOT EXISTS fts_search USING fts5(
  resource UNINDEXED, rid UNINDEXED, body, tokenize = 'trigram'
);
