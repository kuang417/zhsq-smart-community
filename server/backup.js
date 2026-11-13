/**
 * SQLite 在线备份：先 wal_checkpoint(TRUNCATE)，再 VACUUM INTO 生成一致性快照
 * （WAL 模式下包含全部已提交事务，无需停服），随后做 integrity_check 与保留策略。
 * 用法：npm run backup   可通过 ZHSQ_BACKUP_DIR / ZHSQ_BACKUP_KEEP 配置。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import * as S from './sqlite.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = process.env.ZHSQ_BACKUP_DIR
  ? path.resolve(process.env.ZHSQ_BACKUP_DIR)
  : path.join(__dirname, 'data', 'backups')
fs.mkdirSync(dir, { recursive: true })

const d = new Date()
const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
let target = path.join(dir, `zhsq-${stamp}.db`)
// 同秒重复执行不再删除覆盖旧备份，改为追加序号
let seq = 1
while (fs.existsSync(target)) target = path.join(dir, `zhsq-${stamp}-${++seq}.db`)

const db = S.openDb()
db.pragma('wal_checkpoint(TRUNCATE)')
db.prepare('VACUUM INTO ?').run(target)
S.closeDb()

// 快照完整性校验：损坏的备份直接删除并报错，避免「看起来备份成功」的假象
const snap = new Database(target, { readonly: true, fileMustExist: true })
const integrity = snap.pragma('integrity_check', { simple: true })
snap.close()
if (integrity !== 'ok') {
  fs.unlinkSync(target)
  throw new Error(`备份完整性校验失败（${integrity}），已删除无效快照：${target}`)
}
const bytes = fs.readFileSync(target)
const sha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
console.log(`[backup] ${target} (${(bytes.length / 1024 / 1024).toFixed(2)}MB) integrity=ok sha256=${sha}`)

// 保留最近 N 份（默认 30），防止数据卷被历史快照撑满
const keep = Math.max(1, Number(process.env.ZHSQ_BACKUP_KEEP || 30))
const files = fs.readdirSync(dir).filter((f) => /^zhsq-.*\.db$/.test(f)).sort()
for (const f of files.slice(0, Math.max(0, files.length - keep))) {
  fs.unlinkSync(path.join(dir, f))
  console.log(`[backup] 清理过期快照：${f}`)
}
