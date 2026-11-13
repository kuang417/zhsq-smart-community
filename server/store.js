/**
 * 存储层（SQLite 版）
 *
 * 架构：SQLite 是唯一持久化真相，所有写操作走参数化 SQL；内存是只读镜像缓存，
 *       供统计聚合快速复用。启动时从库重建缓存，写操作成功后同步镜像，
 *       事务失败则标记 dirty 并在下次读取时整体重建，保证异常后不出现脏读。
 *
 * 对外保持 Demo 原有导出 API（getDb/getBulk/rows/save/nextId/addOpLog ...），
 * 因此 stats.js 与前端接口契约无需改动；新增 insert/update/remove/list/query 供写路径使用。
 */
import fs from 'node:fs'
import * as S from './sqlite.js'
import { hIndex, hashPassword } from './crypto.js'
import { isProduction } from './keys.js'
import { MENUS, ROLE_MODULES, RESOURCES } from './config.js'
import { currentRequestMeta } from './scope.js'
import { localStamp } from './time.js'

let dbCache = null
let bulkCache = null
let dirty = false

const BULK_KEYS = new Set(['population', 'houses', 'buildings', 'parts'])

/** 进程内单调序列：避免同一毫秒内多条消息/流转/日志主键冲突（200 并发场景） */
let _seq = 0
export const uid = (prefix) => `${prefix}${Date.now().toString(36)}-${(++_seq).toString(36)}`

function rebuildCache() {
  const db = S.conn()
  dbCache = {}
  bulkCache = {}
  for (const r of S.COLLECTIONS) {
    const rows = db.prepare(
      `SELECT data FROM "${S.tableOf(r)}" ORDER BY seq ASC, rowid ASC`
    ).all().map((x) => JSON.parse(x.data))
    if (BULK_KEYS.has(r)) bulkCache[r] = rows
    else dbCache[r] = rows
  }
  for (const k of ['meta', 'dicts']) {
    const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(k)
    dbCache[k] = row ? JSON.parse(row.v) : {}
  }
  dirty = false
}

function ensure() {
  if (!dbCache || dirty) rebuildCache()
}

/**
 * 生产首次初始化：只创建「空业务库 + 一个管理员 + 最小字典 + 菜单权限」，
 * 绝不灌入演示种子数据（种子含明文账号/身份证/手机号，不得进入生产库与镜像）。
 */
function initProductionDb(db) {
  const pwd = process.env.ZHSQ_ADMIN_PASSWORD
  if (!pwd || String(pwd).length < 12) {
    throw new Error('生产环境首次初始化必须通过 ZHSQ_ADMIN_PASSWORD 设置管理员初始密码（至少 12 位）')
  }
  const rootCode = process.env.ZHSQ_ROOT_ORG_CODE || '450102'
  const rootName = process.env.ZHSQ_ROOT_ORG_NAME || '本级行政区'
  const now = localStamp()
  const put = (resource, obj) => {
    const s = S.sealRecord(obj)
    const c = S.columnsOf(JSON.parse(s.data))
    db.prepare(
      `INSERT OR REPLACE INTO "${S.tableOf(resource)}" (id, org_code, grid_code, status, name, data, secure, sec_idx, sec_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(S.rowId(resource, obj, 0), c.org_code, c.grid_code, c.status, c.name, s.data, s.secure, s.sec_idx, s.sec_phone)
  }
  put('users', {
    id: 'U001', username: process.env.ZHSQ_ADMIN_USERNAME || 'admin', password: hashPassword(pwd),
    name: '系统管理员', role: 'district', roleName: '区级管理员',
    orgCode: rootCode, orgLevel: 1, orgName: rootName, scopeDesc: '全部数据范围'
  })
  put('orgs', { orgCode: rootCode, orgName: rootName, orgLevel: 1, parentCode: '', levelName: '区' })

  const menus = []
  const walk = (list, parent = '') => list.forEach((m) => {
    menus.push({ key: m.key, parent, title: m.title, path: m.path || '', icon: m.icon || '', module: m.module, sort: menus.length })
    if (m.children) walk(m.children, m.key)
  })
  walk(MENUS)
  const insMenu = db.prepare('INSERT OR REPLACE INTO sys_menu (menu_key, parent_key, title, path, icon, module, sort_no) VALUES (?, ?, ?, ?, ?, ?, ?)')
  menus.forEach((m) => insMenu.run(m.key, m.parent, m.title, m.path, m.icon, m.module, m.sort))
  const insRole = db.prepare('INSERT OR REPLACE INTO sys_role_menu (role, menu_key) VALUES (?, ?)')
  for (const [role, mods] of Object.entries(ROLE_MODULES)) {
    menus.filter((m) => mods.includes(m.module)).forEach((m) => insRole.run(role, m.key))
  }
  const kv = db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)')
  kv.run('meta', JSON.stringify({ generatedAt: now, initializedBy: 'production-init' }))
  kv.run('dicts', JSON.stringify({
    serviceItems: ['事项申报', '证明办理', '咨询建议'],
    eventTypes: ['环境卫生', '治安隐患', '设施损坏', '邻里纠纷', '其他'],
    tags: ['独居老人', '残疾人', '低保家庭', '留守儿童', '退役军人'],
    popTypes: ['户籍人口', '流动人口', '暂住人口'],
    ageBands: ['0-17岁', '18-35岁', '36-59岁', '60岁以上'],
    partTypes: ['井盖', '路灯', '垃圾桶', '消防栓'],
    meetingTypes: ['支部党员大会', '支委会', '党小组会', '党课'],
    senseThemes: ['视频监控', '烟感', '门禁', '井盖'],
    contentTypes: ['社区新闻', '政策法规', '活动通知']
  }))
  console.warn('[init] 生产空库已初始化：仅管理员账号与最小字典，未写入任何演示业务数据')
}

/**
 * 启动时调用（ESM 顶层 await）。
 * 安全规则：只有「库文件本次新建」才允许自动初始化；已有库文件但业务表为空，
 * 一律拒绝自动重建（防止误清空 / 迁移中断后启动把真实数据覆盖成演示数据）。
 */
export async function load() {
  const existed = fs.existsSync(S.DB_FILE)
  const db = S.openDb()
  // 以 kv.meta 的初始化标记为准，而不是「grids 表是否有行」：
  // 生产空库本来就没有网格数据，用行数判断会导致第二次启动被误判为「库被清空」而拒绝启动。
  const initialized = !!db.prepare("SELECT 1 FROM kv WHERE k = 'meta'").get()
  const gridRows = db.prepare(`SELECT count(*) n FROM "${S.tableOf('grids')}"`).get().n
  if (existed && !initialized && gridRows > 0) {
    throw new Error('检测到已有业务数据但缺少初始化标记：为保护数据，拒绝自动处理。请先备份并人工核对数据库')
  }
  if (!initialized) {
    if (isProduction()) {
      db.transaction(() => initProductionDb(db))()
      console.warn('[init] 生产库初始化完成：无演示数据，管理员密码来自 ZHSQ_ADMIN_PASSWORD')
    } else {
      const { migrate } = await import('./migrate.js')
      migrate({ force: false })
    }
  } else if (gridRows === 0 && !process.env.ZHSQ_ALLOW_SEED_REBUILD) {
    // 已初始化过的库即使网格被清空，也只告警，绝不自动灌演示数据覆盖其余真实表
    console.warn('[startup] 已初始化的库中网格表为空，已跳过任何自动重建（防止覆盖真实业务数据）')
  }
  rebuildCache()
  return dbCache
}

export const getDb = () => { ensure(); return dbCache }
export const getBulk = () => { ensure(); return bulkCache }
export const rows = (resource) => {
  ensure()
  return BULK_KEYS.has(resource) ? (bulkCache[resource] || []) : (dbCache[resource] || [])
}
export const rawRows = rows
export const collection = (resource) => { ensure(); return BULK_KEYS.has(resource) ? bulkCache : dbCache }

/** 写操作已即时落库，保留 save() 仅为兼容旧调用 */
export function save() { /* no-op：SQLite 每次写都是持久化事务 */ }

export const isCompact = (res) => !!S.COMPACT[res]
export const compactCols = (res) => S.COMPACT[res]
export const toObject = (res, row) => S.toObject(res, row)
export const toRow = (res, obj) => (S.COMPACT[res] ? S.COMPACT[res].map((c) => obj[c] ?? '') : obj)

export function writeRows(resource, list) {
  const db = S.conn()
  const t = S.tableOf(resource)
  db.transaction(() => {
    db.exec(`DELETE FROM "${t}"`)
    const ins = db.prepare(
      `INSERT INTO "${t}" (id, org_code, grid_code, status, name, data, secure, sec_idx, sec_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    list.forEach((obj, i) => {
      const s = S.sealRecord(obj)
      const c = S.columnsOf(JSON.parse(s.data))
      ins.run(S.rowId(resource, obj, i), c.org_code, c.grid_code, c.status, c.name, s.data, s.secure, s.sec_idx, s.sec_phone)
    })
  })()
  dirty = true
}

/** 进程内 ID 计数器：首次扫描一次，之后 O(1)，避免 5 万行导入退化成 O(n²) */
const idCounters = new Map()
function syncId(resource, id) {
  const n = parseInt(String(id || '').replace(/\D/g, ''), 10)
  if (!isNaN(n) && n > (idCounters.get(resource) || 0)) idCounters.set(resource, n)
}
export function nextId(resource, prefix) {
  if (!idCounters.has(resource)) {
    let max = 0
    for (const r of rows(resource)) {
      const n = parseInt(String(r.id || '').replace(/\D/g, ''), 10)
      if (!isNaN(n) && n > max) max = n
    }
    idCounters.set(resource, max)
  }
  const n = idCounters.get(resource) + 1
  idCounters.set(resource, n)
  return prefix + String(n).padStart(4, '0')
}

/* ---------------- SQL 写路径 ---------------- */
function upsertFts(resource, id, obj) {
  const db = S.conn()
  db.prepare('DELETE FROM fts_search WHERE resource = ? AND rid = ?').run(resource, id)
  db.prepare('INSERT INTO fts_search (resource, rid, body) VALUES (?, ?, ?)')
    .run(resource, id, S.ftsBody(obj))
}

/**
 * V2.6 审计修复：orgs 以 orgCode 为自然主键（种子数据无 id，SQL 主键即 orgCode），
 * 而 grids 的主键是 id（种子为 G0001）、gridCode 只是业务编码。
 * 此前通用新增对 orgs 也生成一个 id 并写进业务对象，导致配置声明的 primary
 * 与实际 SQL 主键不一致：GET/PUT/DELETE /api/orgs/:orgCode 全部 404。
 * 统一以 RESOURCES.primary 作为读 / 写 / 删 / 索引的唯一依据，
 * 自然键资源不再把合成 id 写入业务对象。
 */
const primaryOf = (resource) => RESOURCES[resource]?.primary || 'id'
const keyOf = (resource, r) => String(
  r?.[primaryOf(resource)] ?? r?.id ?? r?.orgCode ?? r?.gridCode ?? r?.code ?? ''
)

export function insert(resource, obj, { scoped = false } = {}) {
  ensure()
  const db = S.conn()
  const t = S.tableOf(resource)
  const primary = primaryOf(resource)
  const row = { ...obj }
  let id
  if (primary === 'id') {
    if (!row.id) row.id = nextId(resource, resource.slice(0, 2).toUpperCase())
    id = String(row.id)
  } else {
    // 自然键资源：绝不把合成 id 写进业务对象，保持与种子数据一致的字段结构
    delete row.id
    id = String(row[primary] ?? '')
    if (!id) throw new Error(`新增【${resource}】缺少自然主键 ${primary}`)
  }
  const s = S.sealRecord(row)
  const sealed = JSON.parse(s.data)
  const c = S.columnsOf(sealed)
  const seq = db.prepare(`SELECT COALESCE(MIN(seq), 0) - 1 AS s FROM "${t}"`).get().s
  db.prepare(
    `INSERT INTO "${t}" (id, org_code, grid_code, status, name, data, secure, sec_idx, sec_phone, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, c.org_code, c.grid_code, c.status, c.name, s.data, s.secure, s.sec_idx, s.sec_phone, seq)
  upsertFts(resource, id, sealed)
  syncId(resource, id)
  const target = BULK_KEYS.has(resource) ? bulkCache : dbCache
  ;(target[resource] || (target[resource] = [])).unshift(sealed)
  return sealed
}

/** 批量导入：预编译一次 SQL、一次事务，完成后标记内存镜像重建（避免逐行 unshift） */
export function insertMany(resource, list) {
  if (!list.length) return 0
  ensure()
  const db = S.conn()
  const t = S.tableOf(resource)
  const prefix = resource === 'partyMembers' ? 'PM' : resource.slice(0, 2).toUpperCase()
  const ins = db.prepare(
    `INSERT INTO "${t}" (id, org_code, grid_code, status, name, data, secure, sec_idx, sec_phone, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const ftsDel = db.prepare('DELETE FROM fts_search WHERE resource = ? AND rid = ?')
  const ftsIns = db.prepare('INSERT INTO fts_search (resource, rid, body) VALUES (?, ?, ?)')
  let seq = db.prepare(`SELECT COALESCE(MIN(seq), 0) AS s FROM "${t}"`).get().s
  const naturalKey = primaryOf(resource) !== 'id' ? primaryOf(resource) : ''
  for (const item of list) {
    const row = { ...item }
    let id
    if (naturalKey) {
      delete row.id
      id = String(row[naturalKey] ?? '')
      if (!id) throw new Error(`批量导入【${resource}】缺少自然主键 ${naturalKey}`)
    } else {
      if (!row.id) row.id = nextId(resource, prefix)
      id = String(row.id)
    }
    const s = S.sealRecord(row)
    const sealed = JSON.parse(s.data)
    const c = S.columnsOf(sealed)
    ins.run(id, c.org_code, c.grid_code, c.status, c.name, s.data, s.secure, s.sec_idx, s.sec_phone, --seq)
    ftsDel.run(resource, id)
    ftsIns.run(resource, id, S.ftsBody(sealed))
    syncId(resource, id)
  }
  dirty = true
  return list.length
}

/** 统一单条读取：默认按当前请求上下文注入组织前缀（global 资源传 cfg 关闭） */
export function findOne(resource, id, cfg = {}, { reveal = false } = {}) {
  return S.readOne(resource, id, {
    reveal,
    scoped: !cfg.global,
    orgKey: cfg.orgKey || 'orgCode'
  })
}

export function update(resource, id, patch, { expectedVersion } = {}) {
  ensure()
  const db = S.conn()
  const t = S.tableOf(resource)
  const target = BULK_KEYS.has(resource) ? bulkCache : dbCache
  const list = target[resource] || []
  const idx = list.findIndex((r) => keyOf(resource, r) === String(id))
  if (idx < 0) return null
  const prev = db.prepare(`SELECT secure, sec_idx, version FROM "${t}" WHERE id = ?`).get(String(id)) || {}
  // 乐观锁：调用方传入期望版本时，版本不一致直接拒绝，避免并发覆盖
  if (expectedVersion != null && prev.version != null && Number(prev.version) !== Number(expectedVersion)) {
    const e = new Error('并发冲突：数据已被其他操作员修改，请刷新后重试')
    e.code = 40903
    throw e
  }
  // version 是数据库提升列，不得被 patch 写进 JSON 文档；主键以调用方传入的 id 为准，
  // 绝不能用合并后的对象重新推导（orgs/grids 主键是 orgCode/gridCode，改动会导致 UPDATE 命中 0 行
  // 却仍更新内存镜像与 FTS，造成库/缓存/索引三者不一致）
  const { version: _ignoredVersion, ...cleanPatch } = patch || {}
  const merged = { ...list[idx], ...cleanPatch }
  delete merged.version
  const s = S.sealRecord(merged, prev)
  const sealed = JSON.parse(s.data)
  const c = S.columnsOf(sealed)
  const rid = String(id)
  const info = db.prepare(
    `UPDATE "${t}" SET org_code = ?, grid_code = ?, status = ?, name = ?, data = ?, secure = ?, sec_idx = ?, sec_phone = ?, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(c.org_code, c.grid_code, c.status, c.name, s.data, s.secure, s.sec_idx, s.sec_phone, rid)
  if (info.changes === 0) throw new Error(`更新失败：记录 ${resource}/${rid} 已不存在`)
  upsertFts(resource, rid, sealed)
  list[idx] = sealed
  return sealed
}

export function remove(resource, id) {
  ensure()
  const db = S.conn()
  const t = S.tableOf(resource)
  const target = BULK_KEYS.has(resource) ? bulkCache : dbCache
  const list = target[resource] || []
  const idx = list.findIndex((r) => keyOf(resource, r) === String(id))
  if (idx < 0) return false
  const rid = keyOf(resource, list[idx])
  db.prepare(`DELETE FROM "${t}" WHERE id = ?`).run(rid)
  db.prepare('DELETE FROM fts_search WHERE resource = ? AND rid = ?').run(resource, rid)
  list.splice(idx, 1)
  return true
}

export function transaction(fn) {
  try { return S.transaction(fn) }
  catch (e) { dirty = true; throw e }
}

export function addOpLog(user, action, detail) {
  // 正式版审计日志不截断，全部落库；补齐来源 IP / UA，便于事后追溯
  const meta = currentRequestMeta()
  return insert('opLogs', {
    id: uid('LOG'),
    user: user?.name || '居民端', username: user?.username || '-',
    orgCode: user?.orgCode || '-', action, detail,
    ip: meta.ip || '-', userAgent: String(meta.ua || '').slice(0, 200),
    time: localStamp()
  })
}

/* ---------------- SQL 读路径（下推查询） ---------------- */
export const list = (resource, req, cfg = {}, opts = {}) => S.queryList(req, resource, cfg, { page: true, reveal: !!opts.reveal })
export const query = (resource, req, cfg = {}, opts = {}) => S.queryList(req, resource, cfg, { page: false, reveal: !!opts.reveal })
export const fullTextSearch = (keyword, resource, limit) => S.ftsSearch(keyword, resource, limit)
export const findByPhone = (resource, phone) => S.findByPhoneHash(resource, phone)
export const versionOf = (resource, id) => {
  const r = S.conn().prepare(`SELECT version FROM "${S.tableOf(resource)}" WHERE id = ?`).get(String(id))
  return r ? Number(r.version) : null
}

/* ---------------- 居民端查询凭条（三要素） ---------------- */
export const issueResidentQuery = (bizId, bizCode, queryCode, phone) => {
  S.conn().prepare(
    'INSERT OR REPLACE INTO resident_query (biz_id, biz_code, code_hash, phone_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(String(bizId), String(bizCode), hIndex(queryCode), hIndex(phone), localStamp())
}
export const verifyResidentQuery = (bizCode, queryCode, phone) => {
  const row = S.conn().prepare('SELECT biz_id FROM resident_query WHERE biz_code = ? AND code_hash = ? AND phone_hash = ?')
    .get(String(bizCode), hIndex(queryCode), hIndex(phone))
  return row ? String(row.biz_id) : null
}

/* 查询码防暴破：同一业务编号 + 来源 IP 连续错误 5 次锁定 10 分钟，成功即清零 */
export const QUERY_MAX_FAILS = 5
const QUERY_LOCK_MS = 10 * 60 * 1000
export const queryLockRemaining = (key) => {
  const row = S.conn().prepare('SELECT locked_until FROM resident_attempt WHERE attempt_key = ?').get(String(key))
  return row && row.locked_until > Date.now() ? Math.ceil((row.locked_until - Date.now()) / 1000) : 0
}
export function noteQueryFailure(key) {
  const db = S.conn()
  const k = String(key)
  const row = db.prepare('SELECT fails FROM resident_attempt WHERE attempt_key = ?').get(k)
  const fails = (row?.fails || 0) + 1
  const until = fails >= QUERY_MAX_FAILS ? Date.now() + QUERY_LOCK_MS : 0
  db.prepare('INSERT OR REPLACE INTO resident_attempt (attempt_key, fails, locked_until, updated_at) VALUES (?, ?, ?, ?)')
    .run(k, fails, until, localStamp())
  return { fails, lockedSeconds: until ? Math.ceil(QUERY_LOCK_MS / 1000) : 0 }
}
export const clearQueryAttempts = (key) => {
  S.conn().prepare('DELETE FROM resident_attempt WHERE attempt_key = ?').run(String(key))
}

/* ---------------- 权限菜单（表驱动） ---------------- */
export const menusForRole = (role) => {
  const db = S.conn()
  const rows = db.prepare(
    `SELECT m.* FROM sys_menu m JOIN sys_role_menu r ON r.menu_key = m.menu_key WHERE r.role = ? ORDER BY m.sort_no, m.menu_key`
  ).all(role)
  const byKey = new Map()
  rows.forEach((m) => byKey.set(m.menu_key, {
    key: m.menu_key, title: m.title, path: m.path || undefined,
    icon: m.icon || undefined, module: m.module, children: []
  }))
  const roots = []
  for (const m of byKey.values()) {
    const parent = rows.find((x) => x.menu_key === m.key)?.parent_key
    if (parent && byKey.has(parent)) byKey.get(parent).children.push(m)
    else roots.push(m)
  }
  const clean = (m) => {
    const o = { key: m.key, title: m.title, module: m.module }
    if (m.path) o.path = m.path
    if (m.icon) o.icon = m.icon
    if (m.children && m.children.length) o.children = m.children.map(clean)
    return o
  }
  return roots.map(clean)
}
export const permissionsForRole = (role) => S.conn()
  .prepare('SELECT menu_key FROM sys_role_menu WHERE role = ?').all(role).map((r) => r.menu_key)
export const kv = (key) => {
  const row = S.conn().prepare('SELECT v FROM kv WHERE k = ?').get(key)
  return row ? JSON.parse(row.v) : null
}
export const setKv = (key, value) => {
  S.conn().prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run(key, JSON.stringify(value))
  if (dbCache && key === 'dicts') dbCache.dicts = value
}
export const rawConn = () => S.conn()
export const statsInfo = () => {
  const db = S.conn()
  return {
    journal: db.pragma('journal_mode', { simple: true }),
    pageCount: db.pragma('page_count', { simple: true }),
    tables: db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 't_%'").get().n,
    fts: db.prepare('SELECT count(*) n FROM fts_search').get().n
  }
}
