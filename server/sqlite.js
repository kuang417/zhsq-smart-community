/**
 * SQLite 数据层核心：连接、建表、SQL 条件构造
 *
 * 设计：每个业务集合一张「提升列 + JSON 文档」表。
 *   - org_code / grid_code / status / name 提升为真实列并建索引，
 *     使四级数据权限、状态筛选、分页能在 SQL 层完成（不全表捞到内存）；
 *   - 完整对象存 data(JSON)，任意字段用 SQLite JSON1 的 json_extract 查询；
 *   - 所有值走参数绑定，所有动态字段名走白名单，杜绝 SQL 注入。
 *
 * 语言中立：本文件产出的库文件与 SQL 可被 Python(sqlite3)/Java 直接复用。
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { seal, unseal, hIndex, SENSITIVE_FIELDS, isSensitive } from './crypto.js'
import { currentUser, isBypass } from './scope.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(__dirname, 'data')
/** 生产可通过 ZHSQ_DB_FILE 把库放到独立数据卷，便于备份与权限隔离 */
export const DB_FILE = process.env.ZHSQ_DB_FILE
  ? path.resolve(process.env.ZHSQ_DB_FILE)
  : path.join(DATA_DIR, 'zhsq.db')

/** 32 个业务集合（db.json 28 + bulk.json 4），与 config.js RESOURCES 一一对应 */
export const COLLECTIONS = [
  'users', 'orgs', 'grids', 'persons', 'opLogs', 'flowLogs',
  'partyOrgs', 'partyMembers', 'honors', 'memberFlows', 'meetings', 'learnings',
  'learningProgress', 'historyLearn', 'enterprises', 'communities',
  'messages', 'banners', 'shortcuts', 'recommends', 'contents',
  'serviceRequests', 'governanceEvents', 'devices', 'alarms', 'workOrders', 'contracts',
  'population', 'houses', 'buildings', 'parts'
]

/** 人口/房屋紧凑列式数组 -> 对象（与 store.COMPACT 保持一致） */
export const COMPACT = {
  population: ['id', 'name', 'idcard', 'phone', 'type', 'age', 'gender', 'gridCode', 'tags', 'address'],
  houses: ['id', 'code', 'buildingId', 'unit', 'room', 'area', 'gridCode', 'purpose']
}

export const toObject = (resource, row) => {
  if (!Array.isArray(row) || !COMPACT[resource]) return row
  const o = {}
  COMPACT[resource].forEach((c, i) => { o[c] = row[i] })
  return o
}

export const tableOf = (resource) => `t_${resource}`

/** 合成主键：不修改原始对象（data 里保持 Demo 原有字段结构） */
export const rowId = (resource, obj, index) =>
  String(obj?.id ?? obj?.orgCode ?? obj?.gridCode ?? obj?.code ?? `${resource}#${index}`)

/** 提升列提取 */
export const columnsOf = (obj) => ({
  org_code: String(obj?.orgCode ?? obj?.gridCode ?? ''),
  grid_code: String(obj?.gridCode ?? ''),
  status: obj?.status == null ? '' : String(obj.status),
  name: String(obj?.name ?? obj?.gridName ?? obj?.orgName ?? obj?.title ?? obj?.code ?? '')
})

/**
 * 把业务对象密封成入库列：明文敏感字段 -> secure 密文 + data 脱敏副本 + HMAC 索引。
 * prev 为数据库中已有的 secure / sec_idx，用于局部更新时保留未改动字段的原密文。
 */
export function sealRecord(obj, prev = {}) {
  const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}) } catch { return {} } }
  const s = seal(obj, { secure: parse(prev.secure), idx: parse(prev.sec_idx) })
  const idx = parse(s.secIdx)
  return {
    data: JSON.stringify(s.data),
    secure: s.secure,
    sec_idx: s.secIdx,
    sec_phone: idx.phone || idx.applicantPhone || idx.reporterPhone || idx.contact || idx.mobile || ''
  }
}

/** FTS5 检索文本：优先取可检索字段，兜底全字段 */
export const ftsBody = (obj, searchFields) => {
  const keys = searchFields?.length ? searchFields : Object.keys(obj || {})
  const parts = keys.map((k) => obj?.[k]).filter((v) => v != null && typeof v !== 'object')
  return parts.join(' ')
}

/* ---------------- DDL ---------------- */
/** indexes=false 供运行时打开旧库升级用（先加列再建索引），导出的建表脚本用完整版 */
export function buildDDL({ indexes = true } = {}) {
  const lines = [
    '-- 智慧社区治理平台 · SQLite 生产库结构（自动生成，勿手工编辑）',
    '-- 提升列 + JSON 文档表；org_code / grid_code 前缀索引承载四级数据权限',
    '-- SQLite 3.35+ (需 JSON1 / FTS5 trigram)，本环境 SQLite 3.51.2',
    '',
    'PRAGMA journal_mode = WAL;',
    'PRAGMA synchronous = NORMAL;',
    'PRAGMA foreign_keys = ON;',
    'PRAGMA busy_timeout = 5000;',
    '',
    'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);',
    '',
    '-- 令牌吊销名单（logout / 改密即时失效）',
    'CREATE TABLE IF NOT EXISTS auth_revoked (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL, reason TEXT, revoked_at TEXT);',
    'CREATE INDEX IF NOT EXISTS idx_auth_revoked_exp ON auth_revoked(exp);',
    '',
    '-- 菜单与角色权限（正式版权限驱动，替代硬编码）',
    'CREATE TABLE IF NOT EXISTS sys_menu (menu_key TEXT PRIMARY KEY, parent_key TEXT, title TEXT, path TEXT, icon TEXT, module TEXT, sort_no INTEGER);',
    'CREATE TABLE IF NOT EXISTS sys_role_menu (role TEXT NOT NULL, menu_key TEXT NOT NULL, PRIMARY KEY (role, menu_key));',
    '',
    '-- 居民端查询凭条：只存业务编号 + 手机号哈希 + 查询码哈希，不存明文',
    'CREATE TABLE IF NOT EXISTS resident_query (biz_id TEXT PRIMARY KEY, biz_code TEXT NOT NULL, code_hash TEXT NOT NULL, phone_hash TEXT NOT NULL, created_at TEXT);',
    '',
    '-- 居民端查询失败计数：防止 6 位查询码被暴力枚举（按 业务编号+来源 锁定）',
    'CREATE TABLE IF NOT EXISTS resident_attempt (attempt_key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, updated_at TEXT);',
    ''
  ]
  for (const r of COLLECTIONS) {
    const t = tableOf(r)
    lines.push(
      `CREATE TABLE IF NOT EXISTS "${t}" (`,
      '  id          TEXT PRIMARY KEY,',
      "  org_code    TEXT NOT NULL DEFAULT '',",
      "  grid_code   TEXT NOT NULL DEFAULT '',",
      '  status      TEXT,',
      '  name        TEXT,',
      '  data        TEXT NOT NULL,                -- 敏感字段已脱敏，可直接用于展示与模糊检索',
      '  secure      TEXT,                        -- AES-256-GCM 密文，仅敏感授权后可解',
      '  sec_idx     TEXT,                        -- HMAC-SHA256 索引，支持完整值精确匹配',
      '  sec_phone   TEXT,                        -- 手机号哈希提升列，居民端/筛选走索引',
      '  seq         INTEGER NOT NULL DEFAULT 0,   -- 新写入记录取负值，保证「最新在前」且不打乱种子顺序',
      "  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),",
      '  updated_at  TEXT,',
      '  version     INTEGER NOT NULL DEFAULT 0    -- 乐观锁',
      ');',
      ...(indexes ? [
        `CREATE INDEX IF NOT EXISTS "idx_${t}_org"    ON "${t}"(org_code);`,
        `CREATE INDEX IF NOT EXISTS "idx_${t}_grid"   ON "${t}"(grid_code);`,
        `CREATE INDEX IF NOT EXISTS "idx_${t}_status" ON "${t}"(status);`,
        `CREATE INDEX IF NOT EXISTS "idx_${t}_phone"  ON "${t}"(sec_phone);`
      ] : []),
      ''
    )
  }
  lines.push(
    "-- FTS5 全文检索：替代 ElasticSearch，覆盖数据全景四页签与跨实体综合查询",
    "CREATE VIRTUAL TABLE IF NOT EXISTS fts_search USING fts5(",
    "  resource UNINDEXED, rid UNINDEXED, body, tokenize = 'trigram'",
    ');',
    ''
  )
  return lines.join('\n')
}

/**
 * 平滑升级：旧版本库文件直接补加密列与索引，不删文件、不丢数据。
 * 顺序必须是「先加列、后建索引」，否则 CREATE INDEX ... (sec_phone) 会因列不存在失败。
 */
export function ensureSchema(db) {
  for (const r of COLLECTIONS) {
    const t = tableOf(r)
    const cols = new Set(db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name))
    for (const [name, def] of [['secure', 'TEXT'], ['sec_idx', 'TEXT'], ['sec_phone', 'TEXT']]) {
      if (!cols.has(name)) db.exec(`ALTER TABLE "${t}" ADD COLUMN ${name} ${def}`)
    }
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${t}_org" ON "${t}"(org_code)`)
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${t}_grid" ON "${t}"(grid_code)`)
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${t}_status" ON "${t}"(status)`)
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${t}_phone" ON "${t}"(sec_phone)`)
  }
}

let _conn = null

export function openDb(file = DB_FILE) {
  if (_conn) return _conn
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('cache_size = -64000')
  db.pragma('temp_store = MEMORY')
  db.exec(buildDDL({ indexes: false }))
  ensureSchema(db)
  _conn = db
  return db
}

export const conn = () => _conn || openDb()
export const transaction = (fn) => conn().transaction(fn)()

export function closeDb() {
  if (_conn) { _conn.close(); _conn = null }
}

/* ---------------- SQL 条件构造 ---------------- */
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** LIKE 前缀里的 % / _ / 反斜杠必须转义，否则组织编码可被通配符扩大匹配范围 */
const escapeLike = (v) => String(v ?? '').replace(/[\\%_]/g, (m) => '\\' + m)
const RESERVED = new Set([
  'pageNum', 'pageSize', 'keyword', 'orgCode', 'reveal', 'sortField', 'sortOrder',
  '_t', 'exportAll', 'gridCode', 'sensitiveToken', 'queryCode', 'bizCode', 'phoneHash'
])
const je = () => `json_extract(data, ?)` // JSON 路径同样走参数绑定

/** 生成 WHERE 片段（不含 SELECT）；返回 { where, params } */
export function buildWhere(req, cfg = {}, options = {}) {
  const q = req?.query || {}
  // 统一数据权限：优先显式传入，其次请求对象，最后取 AsyncLocalStorage 上下文
  const user = options.user !== undefined ? options.user : (req?.user || currentUser())
  const scoped = !isBypass() && !cfg.global
  const clauses = ['1 = 1']
  const params = []
  const orgKey = cfg.orgKey || 'orgCode'
  const col = orgKey === 'gridCode' ? 'grid_code' : 'org_code'

  // 四级数据权限：SQL 层注入 org_code LIKE '前缀%'（任何接口都绕不过）
  if (scoped && user && user.orgLevel !== 1) {
    clauses.push(`"${col}" LIKE ? ESCAPE '\\'`)
    params.push(`${escapeLike(user.orgCode)}%`)
  }
  // 显式下钻/筛选时进一步收窄（不在权限范围内则直接返回空集）
  const narrow = q.orgCode || q.gridCode
  if (narrow) {
    const n = String(narrow)
    if (scoped && user && user.orgLevel !== 1 && !n.startsWith(String(user.orgCode))) {
      clauses.push('1 = 0')
    } else {
      clauses.push(`"${col}" LIKE ? ESCAPE '\\'`)
      params.push(`${escapeLike(n)}%`)
    }
  }

  // 关键字：按 cfg.search 指定字段做包含匹配；完整身份证/手机号走 HMAC 精确索引
  const rawKw = String(q.keyword || '').trim()
  const kw = rawKw.toLowerCase()
  if (kw) {
    const fields = (cfg.search?.length ? cfg.search : ['name', 'title', 'code', 'gridName', 'orgName'])
      .filter((f) => FIELD_RE.test(f))
    if (fields.length) {
      const orParts = []
      for (const f of fields) {
        orParts.push(`lower(COALESCE(${je()}, '')) LIKE ?`)
        params.push(`$.${f}`, `%${kw}%`)
      }
      if (rawKw && !rawKw.includes('*')) {
        const h = hIndex(rawKw)
        orParts.push('sec_phone = ?')
        params.push(h)
        for (const f of SENSITIVE_FIELDS.filter((x) => x !== 'phone' && x !== 'contact' && x !== 'mobile' && x !== 'applicantPhone' && x !== 'reporterPhone')) {
          orParts.push(`COALESCE(json_extract(sec_idx, ?), '') = ?`)
          params.push(`$.${f}`, h)
        }
      }
      clauses.push('(' + orParts.join(' OR ') + ')')
    }
  }

  // 其余查询参数：任意字段用 JSON1 取值比较（字段名白名单 + 值参数绑定）
  for (const [k, v] of Object.entries(q)) {
    if (RESERVED.has(k) || v === '' || v == null || Array.isArray(v) || !FIELD_RE.test(k)) continue
    const val = String(v)
    // 敏感字段：脱敏值走展示列模糊匹配，完整值走不可逆 HMAC 索引精确匹配
    if (isSensitive(k)) {
      if (val.includes('*')) {
        clauses.push(`CAST(${je()} AS TEXT) LIKE ?`)
        params.push(`$.${k}`, `%${val}%`)
      } else {
        clauses.push(`(sec_phone = ? OR COALESCE(json_extract(sec_idx, ?), '') = ?)`)
        params.push(hIndex(val), `$.${k}`, hIndex(val))
      }
      continue
    }
    if (k.toLowerCase().includes('code')) {
      clauses.push(`CAST(${je()} AS TEXT) LIKE ?`)
      params.push(`$.${k}`, `${val}%`)
    } else {
      clauses.push(`CAST(${je()} AS TEXT) LIKE ?`)
      params.push(`$.${k}`, `%${val}%`)
    }
  }
  return { where: clauses.join(' AND '), params }
}

/** 列表查询（SQL 分页）或全量导出（不分页）；reveal 需由调用方完成授权校验后传入 */
export function queryList(req, resource, cfg = {}, { page = true, reveal = false } = {}) {
  const db = conn()
  const t = tableOf(resource)
  const { where, params } = buildWhere(req, cfg)
  const q = req?.query || {}
  // 下发 version 供前端回传做真正的乐观锁（服务端现读再比对等于没有并发保护）
  const hydrate = (r) => ({ ...unseal(JSON.parse(r.data), r.secure, reveal), version: Number(r.version || 0) })
  let sql, bind
  if (q.sortField && FIELD_RE.test(String(q.sortField))) {
    sql = `SELECT data, secure, version FROM "${t}" WHERE ${where} ORDER BY json_extract(data, ?) ${q.sortOrder === 'asc' ? 'ASC' : 'DESC'}`
    bind = [...params, `$.${q.sortField}`]
  } else {
    sql = `SELECT data, secure, version FROM "${t}" WHERE ${where} ORDER BY seq ASC, rowid ASC`
    bind = params.slice()
  }

  if (!page) {
    const rows = db.prepare(sql).all(...bind)
    return { total: rows.length, records: rows.map(hydrate) }
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE ${where}`).get(...params).n
  const pageNum = Math.max(1, parseInt(q.pageNum, 10) || 1)
  const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize, 10) || 20))
  const rows = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...bind, pageSize, (pageNum - 1) * pageSize)
  return { total, records: rows.map(hydrate), pageNum, pageSize }
}

/** 单条读取：统一在此做组织前缀校验，任何接口都绕不过 */
export function readOne(resource, id, { reveal = false, scoped = true, orgKey = 'orgCode' } = {}) {
  const db = conn()
  const t = tableOf(resource)
  const col = orgKey === 'gridCode' ? 'grid_code' : 'org_code'
  const row = db.prepare(`SELECT data, secure, version, ${col} AS oc FROM "${t}" WHERE id = ?`).get(String(id))
  if (!row) return null
  const user = currentUser()
  if (scoped && !isBypass() && user && user.orgLevel !== 1 && !String(row.oc || '').startsWith(String(user.orgCode))) return null
  return { ...unseal(JSON.parse(row.data), row.secure, reveal), version: Number(row.version || 0) }
}

/** 按手机号哈希索引查找（居民端三要素校验用，避免全表扫描与明文比对） */
export function findByPhoneHash(resource, phone, { orgCode = '' } = {}) {
  const db = conn()
  const t = tableOf(resource)
  const h = hIndex(phone)
  if (!h) return []
  const rows = db.prepare(`SELECT data, secure FROM "${t}" WHERE sec_phone = ?`).all(h)
  return rows.map((r) => unseal(JSON.parse(r.data), r.secure, false))
    .filter((x) => !orgCode || String(x.orgCode || '').startsWith(orgCode))
}

/** FTS5 全文检索（trigram 要求 ≥3 字符，短词自动回退 LIKE） */
export function ftsSearch(keyword, resource = '', limit = 50) {
  const db = conn()
  const kw = String(keyword || '').trim()
  if (!kw) return []
  // 存储层也夹取一次：任何内部调用都不得构造出 LIMIT -1 / LIMIT 1e9 的全表扫描
  const n = Number(limit)
  const safe = Number.isFinite(n) && n > 0 ? Math.min(200, Math.trunc(n)) : 50
  let rows
  if (kw.length < 3) {
    rows = db.prepare(
      `SELECT resource, rid, body FROM fts_search WHERE body LIKE ? ${resource ? 'AND resource = ?' : ''} LIMIT ?`
    ).all(...(resource ? [`%${kw}%`, resource, safe] : [`%${kw}%`, safe]))
  } else {
    rows = db.prepare(
      `SELECT resource, rid, body FROM fts_search WHERE fts_search MATCH ? ${resource ? 'AND resource = ?' : ''} LIMIT ?`
    ).all(...(resource ? [`"${kw.replace(/"/g, '""')}"`, resource, safe] : [`"${kw.replace(/"/g, '""')}"`, safe]))
  }
  const out = []
  for (const r of rows) {
    const row = db.prepare(`SELECT data FROM "${tableOf(r.resource)}" WHERE id = ?`).get(r.rid)
    if (row) out.push({ resource: r.resource, id: r.rid, ...JSON.parse(row.data) })
  }
  return out
}
