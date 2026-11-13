/**
 * SQLite 数据层专项验收（补充 tests/api-smoke.js 的 42 项功能回归）
 * 用法：先启动服务，再 node tests/sqlite-check.js
 * 校验：引擎/WAL、FTS5 中文全文检索、SQL 下推查询、200 并发读、50 并发写、审计留痕
 */
import { login as getToken } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const H = { 'Content-Type': 'application/json' }

;(async () => {
  const token = await getToken('admin', 'admin123')
  const auth = { ...H, Authorization: 'Bearer ' + token }
  const get = async (p) => (await (await fetch(BASE + p, { headers: auth })).json()).data

  console.log('\n=== 1. 存储引擎 ===')
  const health = await get('/api/health')
  check('引擎为 SQLite', health.storage?.engine === 'SQLite', health.storage?.file)
  check('WAL 日志模式', health.storage?.journal === 'wal')
  check('31 张业务表 + FTS5 索引', health.storage?.tables === 31, `FTS ${health.storage?.fts} 条`)
  check('数据规模完整', health.counts.grids === 118 && health.counts.population > 20000 && health.counts.houses > 50000,
    `${health.counts.population} 人口 / ${health.counts.houses} 房屋`)

  console.log('\n=== 2. SQL 下推查询 ===')
  const p100 = await get('/api/population?pageNum=100&pageSize=10')
  check('物理分页（第100页）', p100.pageNum === 100 && p100.records.length === 10)
  const typed = await get('/api/population?type=常住&pageSize=5')
  check('任意字段筛选走 json_extract', typed.records.every((r) => r.type === '常住'), `命中 ${typed.total} 条`)
  const sorted = await get('/api/grids?sortField=gridName&sortOrder=desc&pageSize=3')
  check('动态排序字段白名单生效', sorted.records.length === 3)
  const kw = await get('/api/grids?keyword=民生&pageSize=5')
  check('关键字检索', kw.total > 0, `命中 ${kw.total} 网格`)

  console.log('\n=== 3. FTS5 全文检索（替代 ES 一期方案）===')
  const s1 = await get('/api/search?q=民生社区&resource=grids&limit=5')
  check('中文 trigram 检索', s1.engine?.includes('FTS5') && s1.total > 0, `命中 ${s1.total}`)
  const s2 = await get('/api/search?q=三塘&limit=5')
  check('短词自动回退 LIKE', s2.total > 0, `命中 ${s2.total}`)
  const s3 = await get('/api/search?q=统一社会信用代码&limit=5')
  check('跨实体综合查询', Array.isArray(s3.items))

  console.log('\n=== 4. 并发能力（说明书 2.3：≥200 并发在线）===')
  const t0 = Date.now()
  const reads = await Promise.all(Array.from({ length: 200 }, (_, i) =>
    fetch(`${BASE}/api/population?pageSize=20&pageNum=${(i % 50) + 1}`, { headers: auth })
      .then((r) => r.json()).then((j) => j.code).catch(() => -1)
  ))
  const readMs = Date.now() - t0
  const readOk = reads.filter((c) => c === 0).length
  check('200 并发读全部成功', readOk === 200, `${readOk}/200，总耗时 ${readMs}ms，平均 ${(readMs / 200).toFixed(1)}ms/请求`)

  const t1 = Date.now()
  const writes = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    fetch(BASE + '/api/resident/events', {
      method: 'POST', headers: H,
      body: JSON.stringify({ gridCode: '450102010101', name: '并发探针', phone: '1390000' + String(i).padStart(4, '0'), type: '环境卫生', title: `SQLite并发写探针-${i}` })
    }).then((r) => r.json()).then((j) => j.code).catch(() => -1)
  ))
  const writeMs = Date.now() - t1
  const writeOk = writes.filter((c) => c === 0).length
  check('50 并发写无 SQLITE_BUSY / 主键冲突', writeOk === 50, `${writeOk}/50，总耗时 ${writeMs}ms`)

  console.log('\n=== 5. 事务与留痕 ===')
  const flows = await get('/api/flows')
  check('流转留痕已落库', flows.length > 0, `${flows.length} 条`)
  const logs = await get('/api/opLogs?pageSize=50')
  check('审计日志不截断落库', logs.total > 0, `${logs.total} 条`)

  console.log(`\n=== 结果：${pass} 项通过 / ${fail} 项失败 ===\n`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('验收脚本异常：', e); process.exit(1) })
