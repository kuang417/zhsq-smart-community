/**
 * 历史学习正文完整性回归
 *
 * 修复前缺陷：
 *   historyLearn 种子只有 title（时期·栏目拼接）与一句通用 summary 占位，
 *   没有 content 正文字段，前端点击二级栏目“只有标题、没有实际内容”。
 *
 * 修复后断言：
 *   - historyLearn 共 40 条（5 个时期 × 8 个二级栏目）齐全；
 *   - 每条都带有非空 content 正文，且包含“时期 · 栏目”标识与学习指引；
 *   - 不同栏目（同一时期）正文互不相同，避免千篇一律的占位文案。
 *
 * 用法：先 npm start，再 node tests/history-content.js
 */
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const call = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, code: data?.code, data: data?.data, raw: data }
}

const PERIODS = [
  '新民主主义革命时期', '社会主义革命和建设时期',
  '改革开放和社会主义现代化建设新时期', '中国特色社会主义新时代', '党史学习教育常态化'
]
const COLS = ['重要会议', '重大事件', '英雄人物', '红色地标', '文献选读', '影像资料', '精神谱系', '学习测试']

const main = async () => {
  const token = await login('admin', 'admin123')
  console.log('\n=== 历史学习正文完整性回归 ===')

  const res = await call('/api/historyLearn?pageSize=100', { token })
  const recs = (res.data?.records) || []
  check('历史学习列表可获取', recs.length > 0, `${recs.length} 条`)

  check('历史学习共 40 条（5 时期 × 8 栏目）', recs.length === 40, `${recs.length} 条`)

  const missing = recs.filter((r) => !r.content || !String(r.content).trim())
  check('每条都带有非空正文 content', missing.length === 0, `缺失 ${missing.length} 条`)

  const noHeader = recs.filter((r) => !(r.content || '').includes('·'))
  check('正文包含“时期 · 栏目”标识', noHeader.length === 0, `缺标识 ${noHeader.length} 条`)

  const noGuide = recs.filter((r) => !(r.content || '').includes('学习指引'))
  check('正文包含学习指引', noGuide.length === 0, `缺指引 ${noGuide.length} 条`)

  // 组合齐全：每个 时期×栏目 都至少一条
  const seen = new Set(recs.map((r) => `${r.period}__${r.column}`))
  let combos = 0
  for (const p of PERIODS) for (const c of COLS) if (seen.has(`${p}__${c}`)) combos++
  check('5×8=40 个时期/栏目组合齐全', combos === 40, `${combos} 组合`)

  // 同一下级栏目（不同行）正文互不相同，杜绝占位文案雷同
  const byCol = {}
  for (const r of recs) (byCol[r.column] ||= []).push(r.content)
  const dupCols = Object.entries(byCol).filter(([, arr]) => new Set(arr).size !== arr.length)
  check('同一栏目下各时期正文互不相同', dupCols.length === 0, `雷同栏目 ${dupCols.length} 个`)

  console.log(`\n结果：通过 ${pass} 项，失败 ${failCount} 项`)
  process.exit(failCount ? 1 : 0)
}
main().catch((e) => { console.error('测试异常：', e); process.exit(1) })
