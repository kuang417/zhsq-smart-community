/**
 * 种子数据 -> SQLite 全量迁移（固定随机种子，可重复执行）
 * 用法：node server/migrate.js [--force]
 *
 * 正式版：写入时完成三件事
 *   1) 用户密码转 scrypt 加盐哈希，库里不存明文
 *   2) 身份证/手机号等敏感字段加密（secure）+ 脱敏副本（data）+ HMAC 索引（sec_idx/sec_phone）
 *   3) 展开 MENUS / ROLE_MODULES 落 sys_menu / sys_role_menu 权限表
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as S from './sqlite.js'
import { hashPassword, isPasswordHash } from './crypto.js'
import { isProduction } from './keys.js'
import { MENUS, ROLE_MODULES } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DB_JSON = path.join(S.DATA_DIR, 'db.json')
const BULK_JSON = path.join(S.DATA_DIR, 'bulk.json')
const DDL_FILE = path.join(ROOT, 'sql', 'schema.sqlite.sql')

/** 进入全文索引的资源（数据全景四页签 + 主要业务实体；点位/房屋大表不索引以控体积） */
const FTS_RESOURCES = new Set([
  'grids', 'buildings', 'population', 'enterprises', 'partyMembers',
  'governanceEvents', 'serviceRequests', 'devices', 'alarms', 'contracts', 'orgs'
])

/** 全文索引不含身份证/手机号明文，只索引可公开检索字段 */
const searchFields = {
  population: ['name', 'address', 'tags'],
  partyMembers: ['name', 'orgName'],
  governanceEvents: ['title', 'reporter', 'location'],
  serviceRequests: ['applicant', 'item', 'code'],
  enterprises: ['name', 'creditCode', 'legalPerson', 'address'],
  buildings: ['name', 'buildingType'],
  grids: ['gridName', 'gridCode'],
  orgs: ['orgName', 'orgCode'],
  devices: ['name', 'code', 'location'],
  alarms: ['code', 'type', 'location'],
  contracts: ['code', 'party']
}

function flattenMenus() {
  const out = []
  const walk = (list, parent = '') => {
    list.forEach((m, i) => {
      out.push({
        key: m.key, parent, title: m.title, path: m.path || '',
        icon: m.icon || '', module: m.module, sort: out.length
      })
      if (m.children) walk(m.children, m.key)
    })
  }
  walk(MENUS)
  return out
}

export function migrate({ force = false } = {}) {
  // force 采用「原地清空重建」而非删除库文件：避免文件占用、误删与备份链断裂
  if (force && isProduction() && !process.env.ZHSQ_ALLOW_FORCE) {
    throw new Error('生产环境禁止 --force 重建数据库（会清空业务数据、审计日志与令牌吊销名单）。'
      + '请先备份，确需重建时显式设置 ZHSQ_ALLOW_FORCE=1')
  }
  if (!fs.existsSync(DB_JSON) || !fs.existsSync(BULK_JSON)) {
    throw new Error('种子数据不存在，请先执行 npm run seed')
  }
  // DDL 基线只是开发产物：生产镜像内 sql/ 可能是只读层，写失败不应阻断迁移
  try {
    fs.mkdirSync(path.join(ROOT, 'sql'), { recursive: true })
    fs.writeFileSync(DDL_FILE, S.buildDDL(), 'utf8')
  } catch (e) { console.warn('[migrate] DDL 基线文件写入跳过：', e.message) }

  const db = S.openDb()
  const count = db.prepare(`SELECT count(*) n FROM "${S.tableOf('grids')}"`).get().n
  if (count > 0 && !force) {
    console.log(`[migrate] 已有 ${count} 个网格，跳过（需要重建请加 --force）`)
    return { skipped: true }
  }

  const srcDb = JSON.parse(fs.readFileSync(DB_JSON, 'utf8'))
  const srcBulk = JSON.parse(fs.readFileSync(BULK_JSON, 'utf8'))
  const started = Date.now()
  let total = 0

  db.transaction(() => {
    db.exec('DELETE FROM fts_search')
    db.exec('DELETE FROM auth_revoked')
    db.exec('DELETE FROM resident_query')
    db.exec('DELETE FROM sys_menu')
    db.exec('DELETE FROM sys_role_menu')
    for (const r of S.COLLECTIONS) db.exec(`DELETE FROM "${S.tableOf(r)}"`)
    const insertFts = db.prepare('INSERT INTO fts_search (resource, rid, body) VALUES (?, ?, ?)')

    for (const r of S.COLLECTIONS) {
      const raw = Array.isArray(srcBulk[r]) ? srcBulk[r] : srcDb[r]
      if (!Array.isArray(raw)) continue
      const t = S.tableOf(r)
      const ins = db.prepare(
        `INSERT INTO "${t}" (id, org_code, grid_code, status, name, data, secure, sec_idx, sec_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      raw.forEach((item, i) => {
        let obj = S.toObject(r, item)
        if (r === 'users' && !isPasswordHash(obj.password)) obj = { ...obj, password: hashPassword(obj.password) }
        const s = S.sealRecord(obj)
        const sealed = JSON.parse(s.data)
        const c = S.columnsOf(sealed)
        const id = S.rowId(r, obj, i)
        ins.run(id, c.org_code, c.grid_code, c.status, c.name, s.data, s.secure, s.sec_idx, s.sec_phone)
        if (FTS_RESOURCES.has(r)) insertFts.run(r, id, S.ftsBody(sealed, searchFields[r]))
        total++
      })
    }

    // 权限表：菜单 + 角色授权（按模块展开）
    const menus = flattenMenus()
    const insMenu = db.prepare('INSERT OR REPLACE INTO sys_menu (menu_key, parent_key, title, path, icon, module, sort_no) VALUES (?, ?, ?, ?, ?, ?, ?)')
    menus.forEach((m) => insMenu.run(m.key, m.parent, m.title, m.path, m.icon, m.module, m.sort))
    const insRole = db.prepare('INSERT OR REPLACE INTO sys_role_menu (role, menu_key) VALUES (?, ?)')
    for (const [role, modules] of Object.entries(ROLE_MODULES)) {
      menus.filter((m) => modules.includes(m.module)).forEach((m) => insRole.run(role, m.key))
    }

    const kv = db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)')
    kv.run('meta', JSON.stringify(srcDb.meta || {}))
    kv.run('dicts', JSON.stringify(srcDb.dicts || {}))
  })()

  db.pragma('wal_checkpoint(TRUNCATE)')
  const size = (fs.statSync(S.DB_FILE).size / 1024 / 1024).toFixed(2)
  const fts = db.prepare('SELECT count(*) n FROM fts_search').get().n
  const menuCount = db.prepare('SELECT count(*) n FROM sys_menu').get().n
  console.log(`[migrate] 完成：${S.COLLECTIONS.length} 张表 / ${total} 行 / FTS ${fts} 条 / 菜单 ${menuCount} 条 / ${size}MB / ${Date.now() - started}ms`)
  console.log(`[migrate] 密码已加盐哈希，敏感字段已加密；DDL 已导出：${DDL_FILE}`)
  return { total, fts, size, menuCount, ms: Date.now() - started }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { migrate({ force: process.argv.includes('--force') }) }
  catch (e) { console.error('[migrate] 失败：', e.message); process.exit(1) }
}
