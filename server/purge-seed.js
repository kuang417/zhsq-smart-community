/**
 * 清理明文种子 JSON（虚构演示数据），只保留已加密的 SQLite 库。
 * 生产镜像本身已不打包种子文件（见 Dockerfile），本脚本用于本地/裸机部署清理。
 * 执行后不可再用 npm run reset 自动初始化（需重新 npm run seed），请先备份。
 * 用法：npm run purge:seed
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DB_FILE } from './sqlite.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
let removed = 0
for (const f of ['db.json', 'bulk.json']) {
  const file = path.join(dir, f)
  if (fs.existsSync(file)) { fs.unlinkSync(file); removed++; console.log(`[purge] 已删除 ${file}`) }
}
console.log(`[purge] 完成，删除 ${removed} 个明文种子文件`)
console.log(`[purge] 当前业务库：${fs.existsSync(DB_FILE) ? '保留 ' + DB_FILE : '未找到 ' + DB_FILE}`)
if (!fs.existsSync(DB_FILE)) {
  console.log('[purge] 提示：开发环境可执行 npm run seed && npm run reset 重新生成演示数据；')
  console.log('        生产环境请由服务首次启动创建空业务库（ZHSQ_ADMIN_PASSWORD），不要灌入演示数据。')
}
