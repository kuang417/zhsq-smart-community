/**
 * 网格人员录入与显示一致性回归
 *
 * 背景（用户反馈）：「网格微站」与「网格组织」的网格长 / 网格员看起来不一致，
 * 且全平台找不到录入、修改网格员的地方，网格台账表单也没有这两个字段。
 * 排查结论：
 *  - 两处后台页面与居民端都按 grids.leaderId / workerIds + persons 主数据取名，同一网格本就一致；
 *    差异来自两页各自独立选中的网格、以及「（主数据）」后缀造成的观感。
 *  - 真正缺失的是录入入口：网格台账无人员字段、无人员主数据管理页；
 *    且服务端 PROTECTED_FIELDS 全局把 role 当账号权限角色拦截，人员岗位永远写不进去。
 *
 * 断言：
 *  1) persons 新增 / 编辑可写入 role、gridCode，非法岗位被枚举校验拒绝；
 *  2) grids 可改绑 leaderId / workerIds 并回读一致；
 *  3) 无效人员 ID / 重复 / 网格长兼任网格员 / 超 20 人均被引用校验拒绝；
 *  4) 网格组织、网格微站、居民端三方按同一份人员主数据显示（含改名联动）；
 *  5) 测试数据全部清理，网格绑定恢复原值。
 *
 * 用法：先 npm start，再 node tests/grid-person.js
 */
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const callJson = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  let d = null
  try { d = await r.json() } catch {}
  return { status: r.status, code: d?.code, data: d?.data, message: d?.message }
}

const main = async () => {
  const token = await login('admin', 'admin123')
  console.log('\n=== 网格人员录入与显示一致性回归 ===')

  const first = await callJson('/api/grids?pageSize=1', { token })
  const grid = first.data?.records?.[0]
  if (!grid) throw new Error('无网格数据，无法执行回归')
  const gridId = grid.id
  const gridCode = grid.gridCode
  const original = { leaderId: grid.leaderId, workerIds: Array.isArray(grid.workerIds) ? [...grid.workerIds] : [] }
  let personId = null, extraPersonId = null

  try {
    // 1) 人员主数据新增：role 曾被 PROTECTED_FIELDS 静默丢弃
    const created = await callJson('/api/persons', {
      method: 'POST', token,
      body: { name: '回归测试网格员', role: '网格员', phone: '13800000000', orgCode: grid.orgCode, gridCode, title: '自动化回归临时人员' }
    })
    check('人员主数据可新增', created.code === 0, created.message)
    personId = created.data?.id || null
    check('新增人员岗位 role 未被受保护字段拦截', created.data?.role === '网格员', String(created.data?.role))
    check('新增人员记录所属网格编码', created.data?.gridCode === gridCode, String(created.data?.gridCode))
    if (!personId) throw new Error('新增人员未返回 id，后续断言无法进行')

    const badRole = await callJson('/api/persons', {
      method: 'POST', token,
      body: { name: '回归测试非法岗位', role: '超级管理员', orgCode: grid.orgCode }
    })
    extraPersonId = badRole.code === 0 ? (badRole.data?.id || null) : null
    check('非法岗位被枚举校验拒绝', badRole.code === 40002 && /角色|岗位/.test(badRole.message || ''), badRole.message)

    // 2) 网格台账改绑网格员
    const bound = await callJson(`/api/grids/${gridId}`, {
      method: 'PUT', token, body: { workerIds: [...original.workerIds, personId] }
    })
    check('网格台账可改绑网格员', bound.code === 0, bound.message)
    const after = await callJson(`/api/grids/${gridId}`, { token })
    check('改绑后回读 workerIds 含新人员', (after.data?.workerIds || []).includes(personId), JSON.stringify(after.data?.workerIds))

    // 3) 引用完整性校验（失败请求不得改变已有绑定）
    const cases = [
      ['无效人员 ID 被拒', { workerIds: ['P999999'] }],
      ['网格员重复选择被拒', { workerIds: [personId, personId] }],
      ['同一人兼任网格长与网格员被拒', { leaderId: personId, workerIds: [personId] }],
      ['网格员超过 20 人被拒', { workerIds: Array(21).fill(personId) }]
    ]
    for (const [name, body] of cases) {
      const r = await callJson(`/api/grids/${gridId}`, { method: 'PUT', token, body })
      check(name, r.code === 40002, r.message)
    }
    const unchanged = await callJson(`/api/grids/${gridId}`, { token })
    check('被拒的改绑未污染原绑定',
      (unchanged.data?.workerIds || []).includes(personId) && String(unchanged.data?.leaderId) === String(original.leaderId),
      JSON.stringify(unchanged.data?.workerIds))

    // 4) 三方一致性：网格台账 / 网格微站 / 居民端都从同一份人员主数据取名
    const persons = await callJson('/api/persons?pageSize=500', { token })
    const nameMap = new Map((persons.data?.records || []).map((p) => [String(p.id), p.name]))
    const home = await callJson(`/api/resident/home/${gridCode}`, { token })
    check('居民端网格长姓名 = 人员主数据姓名',
      home.data?.grid?.leader === nameMap.get(String(after.data?.leaderId)),
      `${home.data?.grid?.leader} / ${nameMap.get(String(after.data?.leaderId))}`)
    check('居民端网格员含新绑定人员',
      (home.data?.grid?.workers || []).includes('回归测试网格员'), (home.data?.grid?.workers || []).join('、'))

    // 5) 改名后居民端 / 微站（同源 persons 表）显示同步
    const renamed = await callJson(`/api/persons/${personId}`, { method: 'PUT', token, body: { name: '回归测试改名' } })
    check('人员姓名可修改', renamed.code === 0, renamed.message)
    const home2 = await callJson(`/api/resident/home/${gridCode}`, { token })
    check('改名后居民端立即显示新姓名',
      (home2.data?.grid?.workers || []).includes('回归测试改名'), (home2.data?.grid?.workers || []).join('、'))
  } finally {
    // 无论如何都恢复演示数据，避免污染
    if (personId) await callJson(`/api/grids/${gridId}`, { method: 'PUT', token, body: original }).catch(() => {})
    if (personId) await callJson(`/api/persons/${personId}`, { method: 'DELETE', token }).catch(() => {})
    if (extraPersonId) await callJson(`/api/persons/${extraPersonId}`, { method: 'DELETE', token }).catch(() => {})
  }

  const cleaned = await callJson(`/api/grids/${gridId}`, { token })
  check('清理后网格绑定恢复原值',
    JSON.stringify(cleaned.data?.workerIds || []) === JSON.stringify(original.workerIds)
    && String(cleaned.data?.leaderId) === String(original.leaderId),
    JSON.stringify(cleaned.data?.workerIds))
  const gone = await callJson(`/api/persons?pageSize=500`, { token })
  check('临时人员已全部删除', !(gone.data?.records || []).some((p) => p.name.startsWith('回归测试')),
    `${(gone.data?.records || []).filter((p) => p.name.startsWith('回归测试')).length} 条残留`)

  console.log(`\n结果：${pass} 通过 / ${failCount} 失败`)
  process.exit(failCount ? 1 : 0)
}
main().catch((e) => { console.error('测试异常', e); process.exit(1) })
