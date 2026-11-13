/**
 * 历史学习正文补正（存量数据）
 * ------------------------------------------------------------
 * 之前 historyLearn 只有 title/summary 占位，没有 content 正文，导致前端
 * 点击二级栏目“只有标题没有内容”。seed.js 已改为生成时带 content，但已写入
 * SQLite 的历史数据不会自动变。本脚本仅为 t_historyLearn 现有行补充 content，
 * 不动其他任何表、不重置演示数据。
 *
 * 用法：node server/patch-history-content.js
 */
import { getDb, update } from './store.js'
import { buildHistoryContent } from './history-content.js'

const db = getDb()
const all = (db.historyLearn || []).filter(Boolean)
let patched = 0
let skipped = 0
for (const r of all) {
  if (r.content && String(r.content).trim()) { skipped++; continue }
  update('historyLearn', r.id, { content: buildHistoryContent(r.period, r.column) })
  patched++
}
console.log(`[patch] 历史学习正文补正完成：新增 ${patched} 条，已存在跳过 ${skipped} 条（共 ${all.length} 条）`)
